//! MQTT connection management.
//!
//! One active broker connection at a time. Incoming publishes are batched and
//! sent to the UI every ~100 ms as a single `mqtt-messages` event so busy
//! brokers (Home Assistant, zigbee2mqtt, ...) don't flood the webview.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use rumqttc::{AsyncClient, ConnectReturnCode, Event, MqttOptions, Packet, QoS, Transport};
use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, Mutex};

const MAX_PACKET_SIZE: usize = 16 * 1024 * 1024;
const FLUSH_INTERVAL: Duration = Duration::from_millis(100);
const RECONNECT_DELAY: Duration = Duration::from_secs(3);

#[derive(Default)]
pub struct MqttState {
    conn: Mutex<Option<Connection>>,
}

struct Connection {
    client: AsyncClient,
    tasks: Vec<JoinHandle<()>>,
}

impl Connection {
    fn shutdown(self) {
        let _ = self.client.try_disconnect();
        for t in self.tasks {
            t.abort();
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectConfig {
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub tls: bool,
    #[serde(default = "default_keep_alive")]
    pub keep_alive_secs: u64,
    #[serde(default = "default_subscriptions")]
    pub subscriptions: Vec<String>,
}

fn default_keep_alive() -> u64 {
    30
}
fn default_subscriptions() -> Vec<String> {
    vec!["#".into(), "$SYS/#".into()]
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingMessage {
    topic: String,
    /// UTF-8 text when the payload is valid UTF-8, otherwise base64.
    payload: String,
    binary: bool,
    size: usize,
    qos: u8,
    retain: bool,
    /// Milliseconds since the Unix epoch.
    timestamp: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum Status {
    Connecting,
    Connected,
    Reconnecting { error: String },
    Disconnected,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn qos_from(n: u8) -> QoS {
    match n {
        1 => QoS::AtLeastOnce,
        2 => QoS::ExactlyOnce,
        _ => QoS::AtMostOnce,
    }
}

fn qos_to(q: QoS) -> u8 {
    match q {
        QoS::AtMostOnce => 0,
        QoS::AtLeastOnce => 1,
        QoS::ExactlyOnce => 2,
    }
}

fn to_message(p: &rumqttc::Publish) -> IncomingMessage {
    let (payload, binary) = match std::str::from_utf8(&p.payload) {
        Ok(s) => (s.to_owned(), false),
        Err(_) => (
            base64::engine::general_purpose::STANDARD.encode(&p.payload),
            true,
        ),
    };
    IncomingMessage {
        topic: p.topic.clone(),
        payload,
        binary,
        size: p.payload.len(),
        qos: qos_to(p.qos),
        retain: p.retain,
        timestamp: now_ms(),
    }
}

fn default_client_id() -> String {
    format!("tidepool-{:08x}", now_ms() as u32 ^ std::process::id())
}

#[tauri::command]
pub async fn mqtt_connect(
    app: AppHandle,
    state: State<'_, MqttState>,
    config: ConnectConfig,
) -> Result<(), String> {
    let host = config.host.trim().to_string();
    if host.is_empty() {
        return Err("Host is required".into());
    }

    let mut guard = state.conn.lock().await;
    if let Some(old) = guard.take() {
        old.shutdown();
    }

    let client_id = config
        .client_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(default_client_id);

    let mut opts = MqttOptions::new(client_id, host, config.port);
    opts.set_keep_alive(Duration::from_secs(config.keep_alive_secs.max(5)));
    opts.set_max_packet_size(MAX_PACKET_SIZE, MAX_PACKET_SIZE);
    opts.set_clean_session(true);
    if let Some(user) = config.username.as_deref().filter(|u| !u.is_empty()) {
        opts.set_credentials(user, config.password.clone().unwrap_or_default());
    }
    if config.tls {
        opts.set_transport(Transport::tls_with_default_config());
    }

    let (client, mut eventloop) = AsyncClient::new(opts, 256);
    let subscriptions: Vec<String> = config
        .subscriptions
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let _ = app.emit("mqtt-status", Status::Connecting);

    let (tx, mut rx) = mpsc::unbounded_channel::<IncomingMessage>();

    // Event loop: drives the connection, reconnects on error.
    let loop_app = app.clone();
    let loop_client = client.clone();
    let event_task = tauri::async_runtime::spawn(async move {
        loop {
            match eventloop.poll().await {
                Ok(Event::Incoming(Packet::Publish(p))) => {
                    let _ = tx.send(to_message(&p));
                }
                Ok(Event::Incoming(Packet::ConnAck(ack))) => {
                    if ack.code == ConnectReturnCode::Success {
                        let _ = loop_app.emit("mqtt-status", Status::Connected);
                        // Clean session: re-subscribe after every (re)connect.
                        // Done in a separate task so we never block polling.
                        let c = loop_client.clone();
                        let subs = subscriptions.clone();
                        tauri::async_runtime::spawn(async move {
                            for s in subs {
                                let _ = c.subscribe(s, QoS::AtMostOnce).await;
                            }
                        });
                    }
                }
                Ok(_) => {}
                Err(e) => {
                    let _ = loop_app.emit(
                        "mqtt-status",
                        Status::Reconnecting {
                            error: e.to_string(),
                        },
                    );
                    tokio::time::sleep(RECONNECT_DELAY).await;
                }
            }
        }
    });

    // Flusher: batches messages to the UI.
    let flush_app = app.clone();
    let flush_task = tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(FLUSH_INTERVAL);
        let mut buf: Vec<IncomingMessage> = Vec::new();
        loop {
            tick.tick().await;
            while let Ok(m) = rx.try_recv() {
                buf.push(m);
            }
            if !buf.is_empty() {
                let _ = flush_app.emit("mqtt-messages", std::mem::take(&mut buf));
            }
            if rx.is_closed() && rx.is_empty() {
                break;
            }
        }
    });

    *guard = Some(Connection {
        client,
        tasks: vec![event_task, flush_task],
    });
    Ok(())
}

#[tauri::command]
pub async fn mqtt_disconnect(app: AppHandle, state: State<'_, MqttState>) -> Result<(), String> {
    if let Some(conn) = state.conn.lock().await.take() {
        conn.shutdown();
    }
    let _ = app.emit("mqtt-status", Status::Disconnected);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishRequest {
    topic: String,
    payload: String,
    #[serde(default)]
    qos: u8,
    #[serde(default)]
    retain: bool,
}

#[tauri::command]
pub async fn mqtt_publish(state: State<'_, MqttState>, req: PublishRequest) -> Result<(), String> {
    if req.topic.is_empty() || req.topic.contains(['#', '+']) {
        return Err("Topic must be non-empty and contain no wildcards".into());
    }
    let guard = state.conn.lock().await;
    let conn = guard.as_ref().ok_or("Not connected")?;
    conn.client
        .publish(req.topic, qos_from(req.qos), req.retain, req.payload.into_bytes())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mqtt_subscribe(state: State<'_, MqttState>, topic: String) -> Result<(), String> {
    let guard = state.conn.lock().await;
    let conn = guard.as_ref().ok_or("Not connected")?;
    conn.client
        .subscribe(topic, QoS::AtMostOnce)
        .await
        .map_err(|e| e.to_string())
}
