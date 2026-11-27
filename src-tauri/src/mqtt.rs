//! MQTT connection management.
//!
//! One active broker connection at a time, over MQTT 3.1.1 or MQTT 5.
//! Incoming publishes are batched and sent to the UI every ~100 ms as a single
//! `mqtt-messages` event so busy brokers (Home Assistant, zigbee2mqtt, ...)
//! don't flood the webview.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use rumqttc::v5;
use rumqttc::v5::mqttbytes::v5::{Packet as Packet5, PublishProperties};
use rumqttc::{Event, Packet, TlsConfiguration, Transport};
use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, Mutex};

use crate::tls::{self, TlsOptions};

const MAX_PACKET_SIZE: usize = 16 * 1024 * 1024;
const FLUSH_INTERVAL: Duration = Duration::from_millis(100);
const RECONNECT_DELAY: Duration = Duration::from_secs(3);

#[derive(Default)]
pub struct MqttState {
    conn: Mutex<Option<Connection>>,
}

struct Connection {
    client: Client,
    tasks: Vec<JoinHandle<()>>,
}

impl Connection {
    fn shutdown(self) {
        self.client.disconnect();
        for t in self.tasks {
            t.abort();
        }
    }
}

/// The client for whichever protocol version the profile uses.
#[derive(Clone)]
enum Client {
    V4(rumqttc::AsyncClient),
    V5(v5::AsyncClient),
}

impl Client {
    async fn subscribe(&self, topic: String, qos: u8) -> Result<(), String> {
        match self {
            Client::V4(c) => c.subscribe(topic, qos4(qos)).await.map_err(|e| e.to_string()),
            Client::V5(c) => c.subscribe(topic, qos5(qos)).await.map_err(|e| e.to_string()),
        }
    }

    async fn publish(&self, req: PublishRequest) -> Result<(), String> {
        let payload = req.payload.into_bytes();
        match self {
            Client::V4(c) => c
                .publish(req.topic, qos4(req.qos), req.retain, payload)
                .await
                .map_err(|e| e.to_string()),
            Client::V5(c) => {
                let p = req.properties.unwrap_or_default();
                let props = PublishProperties {
                    content_type: p.content_type.filter(|s| !s.is_empty()),
                    response_topic: p.response_topic.filter(|s| !s.is_empty()),
                    message_expiry_interval: p.message_expiry,
                    user_properties: p.user_properties,
                    ..Default::default()
                };
                c.publish_with_properties(req.topic, qos5(req.qos), req.retain, payload, props)
                    .await
                    .map_err(|e| e.to_string())
            }
        }
    }

    fn disconnect(&self) {
        let _ = match self {
            Client::V4(c) => c.try_disconnect().map_err(|e| e.to_string()),
            Client::V5(c) => c.try_disconnect().map_err(|e| e.to_string()),
        };
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum SubscriptionEntry {
    /// Older profiles: just a topic filter (QoS 0).
    Topic(String),
    Full {
        topic: String,
        #[serde(default)]
        qos: u8,
    },
}

#[derive(Debug, Clone)]
struct Subscription {
    topic: String,
    qos: u8,
}

impl From<SubscriptionEntry> for Subscription {
    fn from(e: SubscriptionEntry) -> Self {
        match e {
            SubscriptionEntry::Topic(topic) => Subscription { topic, qos: 0 },
            SubscriptionEntry::Full { topic, qos } => Subscription { topic, qos: qos.min(2) },
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
    #[serde(default)]
    pub tls_options: TlsOptions,
    /// 4 = MQTT 3.1.1, 5 = MQTT 5.
    #[serde(default = "default_protocol")]
    pub protocol: u8,
    #[serde(default = "default_keep_alive")]
    pub keep_alive_secs: u64,
    #[serde(default = "default_subscriptions")]
    subscriptions: Vec<SubscriptionEntry>,
}

fn default_protocol() -> u8 {
    4
}
fn default_keep_alive() -> u64 {
    30
}
fn default_subscriptions() -> Vec<SubscriptionEntry> {
    vec![
        SubscriptionEntry::Topic("#".into()),
        SubscriptionEntry::Topic("$SYS/#".into()),
    ]
}

/// MQTT 5 properties of a received message (absent on MQTT 3.1.1).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageProperties {
    #[serde(skip_serializing_if = "Option::is_none")]
    content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_topic: Option<String>,
    /// Correlation data as text when it's UTF-8, otherwise hex.
    #[serde(skip_serializing_if = "Option::is_none")]
    correlation_data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message_expiry: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload_format: Option<u8>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    user_properties: Vec<(String, String)>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    subscription_ids: Vec<usize>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    properties: Option<MessageProperties>,
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

fn qos4(n: u8) -> rumqttc::QoS {
    match n {
        1 => rumqttc::QoS::AtLeastOnce,
        2 => rumqttc::QoS::ExactlyOnce,
        _ => rumqttc::QoS::AtMostOnce,
    }
}

fn qos5(n: u8) -> v5::mqttbytes::QoS {
    match n {
        1 => v5::mqttbytes::QoS::AtLeastOnce,
        2 => v5::mqttbytes::QoS::ExactlyOnce,
        _ => v5::mqttbytes::QoS::AtMostOnce,
    }
}

fn encode_payload(bytes: &[u8]) -> (String, bool) {
    match std::str::from_utf8(bytes) {
        Ok(s) => (s.to_owned(), false),
        Err(_) => (base64::engine::general_purpose::STANDARD.encode(bytes), true),
    }
}

fn to_message(p: &rumqttc::Publish) -> IncomingMessage {
    let (payload, binary) = encode_payload(&p.payload);
    IncomingMessage {
        topic: p.topic.clone(),
        payload,
        binary,
        size: p.payload.len(),
        qos: p.qos as u8,
        retain: p.retain,
        timestamp: now_ms(),
        properties: None,
    }
}

fn to_message5(p: &v5::mqttbytes::v5::Publish) -> IncomingMessage {
    let (payload, binary) = encode_payload(&p.payload);
    let properties = p.properties.as_ref().map(|pp| MessageProperties {
        content_type: pp.content_type.clone(),
        response_topic: pp.response_topic.clone(),
        correlation_data: pp.correlation_data.as_ref().map(|d| match std::str::from_utf8(d) {
            Ok(s) => s.to_owned(),
            Err(_) => d.iter().map(|b| format!("{b:02x}")).collect(),
        }),
        message_expiry: pp.message_expiry_interval,
        payload_format: pp.payload_format_indicator,
        user_properties: pp.user_properties.clone(),
        subscription_ids: pp.subscription_identifiers.clone(),
    });
    IncomingMessage {
        topic: String::from_utf8_lossy(&p.topic).into_owned(),
        payload,
        binary,
        size: p.payload.len(),
        qos: p.qos as u8,
        retain: p.retain,
        timestamp: now_ms(),
        properties,
    }
}

fn default_client_id() -> String {
    format!("tidepool-{:08x}", now_ms() as u32 ^ std::process::id())
}

/// Clean session: re-subscribe after every (re)connect. Runs in its own task
/// so the event loop never blocks on the request queue.
fn resubscribe(client: &Client, subs: &[Subscription]) {
    let c = client.clone();
    let subs = subs.to_vec();
    tauri::async_runtime::spawn(async move {
        for s in subs {
            let _ = c.subscribe(s.topic, s.qos).await;
        }
    });
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

    let transport = if config.tls {
        let tls = tls::client_config(&config.tls_options)?;
        Some(Transport::tls_with_config(TlsConfiguration::Rustls(Arc::new(tls))))
    } else {
        None
    };

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
    let keep_alive = Duration::from_secs(config.keep_alive_secs.max(5));
    let credentials = config
        .username
        .as_deref()
        .filter(|u| !u.is_empty())
        .map(|u| (u.to_owned(), config.password.clone().unwrap_or_default()));

    let subscriptions: Vec<Subscription> = config
        .subscriptions
        .into_iter()
        .map(Subscription::from)
        .map(|s| Subscription { topic: s.topic.trim().to_string(), ..s })
        .filter(|s| !s.topic.is_empty())
        .collect();

    let _ = app.emit("mqtt-status", Status::Connecting);
    let (tx, rx) = mpsc::unbounded_channel::<IncomingMessage>();

    let (client, event_task) = if config.protocol == 5 {
        let mut opts = v5::MqttOptions::new(client_id, host, config.port);
        opts.set_keep_alive(keep_alive);
        opts.set_max_packet_size(Some(MAX_PACKET_SIZE as u32));
        opts.set_clean_start(true);
        if let Some((u, p)) = credentials {
            opts.set_credentials(u, p);
        }
        if let Some(t) = transport {
            opts.set_transport(t);
        }
        let (c, eventloop) = v5::AsyncClient::new(opts, 256);
        let client = Client::V5(c);
        let task = spawn_v5(app.clone(), client.clone(), eventloop, subscriptions, tx);
        (client, task)
    } else {
        let mut opts = rumqttc::MqttOptions::new(client_id, host, config.port);
        opts.set_keep_alive(keep_alive);
        opts.set_max_packet_size(MAX_PACKET_SIZE, MAX_PACKET_SIZE);
        opts.set_clean_session(true);
        if let Some((u, p)) = credentials {
            opts.set_credentials(u, p);
        }
        if let Some(t) = transport {
            opts.set_transport(t);
        }
        let (c, eventloop) = rumqttc::AsyncClient::new(opts, 256);
        let client = Client::V4(c);
        let task = spawn_v4(app.clone(), client.clone(), eventloop, subscriptions, tx);
        (client, task)
    };

    let flush_task = spawn_flusher(app, rx);
    *guard = Some(Connection {
        client,
        tasks: vec![event_task, flush_task],
    });
    Ok(())
}

/// MQTT 3.1.1 event loop: drives the connection and reconnects on error.
fn spawn_v4(
    app: AppHandle,
    client: Client,
    mut eventloop: rumqttc::EventLoop,
    subs: Vec<Subscription>,
    tx: mpsc::UnboundedSender<IncomingMessage>,
) -> JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        loop {
            match eventloop.poll().await {
                Ok(Event::Incoming(Packet::Publish(p))) => {
                    let _ = tx.send(to_message(&p));
                }
                Ok(Event::Incoming(Packet::ConnAck(ack)))
                    if ack.code == rumqttc::ConnectReturnCode::Success =>
                {
                    let _ = app.emit("mqtt-status", Status::Connected);
                    resubscribe(&client, &subs);
                }
                Ok(_) => {}
                Err(e) => {
                    let _ = app.emit("mqtt-status", Status::Reconnecting { error: e.to_string() });
                    tokio::time::sleep(RECONNECT_DELAY).await;
                }
            }
        }
    })
}

/// MQTT 5 event loop: same as [spawn_v4] with the v5 packet types.
fn spawn_v5(
    app: AppHandle,
    client: Client,
    mut eventloop: v5::EventLoop,
    subs: Vec<Subscription>,
    tx: mpsc::UnboundedSender<IncomingMessage>,
) -> JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        loop {
            match eventloop.poll().await {
                Ok(v5::Event::Incoming(Packet5::Publish(p))) => {
                    let _ = tx.send(to_message5(&p));
                }
                Ok(v5::Event::Incoming(Packet5::ConnAck(ack)))
                    if ack.code == v5::mqttbytes::v5::ConnectReturnCode::Success =>
                {
                    let _ = app.emit("mqtt-status", Status::Connected);
                    resubscribe(&client, &subs);
                }
                Ok(_) => {}
                Err(e) => {
                    let _ = app.emit("mqtt-status", Status::Reconnecting { error: e.to_string() });
                    tokio::time::sleep(RECONNECT_DELAY).await;
                }
            }
        }
    })
}

/// Batches messages to the UI.
fn spawn_flusher(app: AppHandle, mut rx: mpsc::UnboundedReceiver<IncomingMessage>) -> JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(FLUSH_INTERVAL);
        let mut buf: Vec<IncomingMessage> = Vec::new();
        loop {
            tick.tick().await;
            while let Ok(m) = rx.try_recv() {
                buf.push(m);
            }
            if !buf.is_empty() {
                let _ = app.emit("mqtt-messages", std::mem::take(&mut buf));
            }
            if rx.is_closed() && rx.is_empty() {
                break;
            }
        }
    })
}

#[tauri::command]
pub async fn mqtt_disconnect(app: AppHandle, state: State<'_, MqttState>) -> Result<(), String> {
    if let Some(conn) = state.conn.lock().await.take() {
        conn.shutdown();
    }
    let _ = app.emit("mqtt-status", Status::Disconnected);
    Ok(())
}

/// MQTT 5 properties to attach to a published message (ignored on 3.1.1).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishProps {
    #[serde(default)]
    content_type: Option<String>,
    #[serde(default)]
    response_topic: Option<String>,
    #[serde(default)]
    message_expiry: Option<u32>,
    #[serde(default)]
    user_properties: Vec<(String, String)>,
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
    #[serde(default)]
    properties: Option<PublishProps>,
}

#[tauri::command]
pub async fn mqtt_publish(state: State<'_, MqttState>, req: PublishRequest) -> Result<(), String> {
    if req.topic.is_empty() || req.topic.contains(['#', '+']) {
        return Err("Topic must be non-empty and contain no wildcards".into());
    }
    let client = {
        let guard = state.conn.lock().await;
        guard.as_ref().ok_or("Not connected")?.client.clone()
    };
    client.publish(req).await
}

#[tauri::command]
pub async fn mqtt_subscribe(
    state: State<'_, MqttState>,
    topic: String,
    qos: Option<u8>,
) -> Result<(), String> {
    let client = {
        let guard = state.conn.lock().await;
        guard.as_ref().ok_or("Not connected")?.client.clone()
    };
    client.subscribe(topic, qos.unwrap_or(0).min(2)).await
}
