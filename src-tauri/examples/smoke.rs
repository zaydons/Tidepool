// Quick connectivity check, using the app's own TLS setup:
//   cargo run --example smoke -- <host> <port> [tls] [--v5] [--ca FILE]
//                                [--cert FILE --key FILE] [--insecure]
// Subscribes to a private test topic, publishes "hello" and waits for it.
use std::sync::Arc;
use std::time::Duration;

use rumqttc::{TlsConfiguration, Transport};
use tidepool_lib::tls::{client_config, TlsOptions};

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let flag = |name: &str| args.iter().any(|a| a == name);
    let value = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1).cloned())
    };
    let host = args.first().cloned().unwrap_or("test.mosquitto.org".into());
    let port: u16 = args.get(1).and_then(|p| p.parse().ok()).unwrap_or(1883);
    let opts = TlsOptions {
        ca_file: value("--ca"),
        client_cert_file: value("--cert"),
        client_key_file: value("--key"),
        insecure: flag("--insecure"),
    };
    let tls = flag("tls") || flag("--tls") || opts.ca_file.is_some() || opts.insecure;
    let transport = if tls {
        match client_config(&opts) {
            Ok(c) => Some(Transport::tls_with_config(TlsConfiguration::Rustls(Arc::new(c)))),
            Err(e) => {
                println!("tls config error: {e}");
                return;
            }
        }
    } else {
        None
    };
    let id = format!("smoke-{}", std::process::id());
    let topic = format!("tidepool-smoke/{}", std::process::id());
    let result = if flag("--v5") {
        v5(id, host, port, transport, topic).await
    } else {
        v4(id, host, port, transport, topic).await
    };
    println!("{}", result.unwrap_or_else(|| "timeout".into()));
}

async fn v4(id: String, host: String, port: u16, t: Option<Transport>, topic: String) -> Option<String> {
    use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
    let mut o = MqttOptions::new(id, host, port);
    if let Some(t) = t {
        o.set_transport(t);
    }
    let (c, mut el) = AsyncClient::new(o, 16);
    c.subscribe(&topic, QoS::AtLeastOnce).await.unwrap();
    c.publish(&topic, QoS::AtLeastOnce, false, "hello").await.unwrap();
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            match el.poll().await {
                Ok(Event::Incoming(Packet::ConnAck(a))) => println!("connack {:?}", a.code),
                Ok(Event::Incoming(Packet::SubAck(s))) => println!("suback {:?}", s.return_codes),
                Ok(Event::Incoming(Packet::Publish(p))) if p.topic == topic => {
                    return format!("received {:?} (qos {:?})", p.payload, p.qos);
                }
                Ok(_) => {}
                Err(e) => return format!("error {e}"),
            }
        }
    })
    .await
    .ok()
}

async fn v5(id: String, host: String, port: u16, t: Option<Transport>, topic: String) -> Option<String> {
    use rumqttc::v5::mqttbytes::v5::{Packet, PublishProperties};
    use rumqttc::v5::mqttbytes::QoS;
    use rumqttc::v5::{AsyncClient, Event, MqttOptions};
    let mut o = MqttOptions::new(id, host, port);
    if let Some(t) = t {
        o.set_transport(t);
    }
    let (c, mut el) = AsyncClient::new(o, 16);
    c.subscribe(&topic, QoS::AtLeastOnce).await.unwrap();
    let props = PublishProperties {
        content_type: Some("text/plain".into()),
        user_properties: vec![("source".into(), "smoke".into())],
        ..Default::default()
    };
    c.publish_with_properties(&topic, QoS::AtLeastOnce, false, "hello", props)
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            match el.poll().await {
                Ok(Event::Incoming(Packet::ConnAck(a))) => println!("connack v5 {:?}", a.code),
                Ok(Event::Incoming(Packet::Publish(p))) if p.topic == topic.as_bytes() => {
                    let pp = p.properties.unwrap_or_default();
                    return format!(
                        "received {:?} content_type={:?} user_properties={:?}",
                        p.payload, pp.content_type, pp.user_properties
                    );
                }
                Ok(_) => {}
                Err(e) => return format!("error {e}"),
            }
        }
    })
    .await
    .ok()
}
