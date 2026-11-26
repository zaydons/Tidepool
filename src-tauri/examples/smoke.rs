// Quick connectivity check: cargo run --example smoke -- <host> <port> [tls]
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS, Transport};
use std::time::Duration;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let host = args.get(1).cloned().unwrap_or("test.mosquitto.org".into());
    let port: u16 = args.get(2).and_then(|p| p.parse().ok()).unwrap_or(1883);
    let tls = args.get(3).map(|s| s == "tls").unwrap_or(false);
    let mut o = MqttOptions::new(format!("smoke-{}", std::process::id()), host, port);
    o.set_max_packet_size(16 << 20, 16 << 20);
    if tls { o.set_transport(Transport::tls_with_default_config()); }
    let (c, mut el) = AsyncClient::new(o, 16);
    let topic = format!("tidepool-smoke/{}", std::process::id());
    c.subscribe(&topic, QoS::AtMostOnce).await.unwrap();
    c.publish(&topic, QoS::AtLeastOnce, false, "hello").await.unwrap();
    let r = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            match el.poll().await {
                Ok(Event::Incoming(Packet::ConnAck(a))) => println!("connack {:?}", a.code),
                Ok(Event::Incoming(Packet::Publish(p))) if p.topic == topic => { println!("received {:?}", p.payload); break; }
                Ok(_) => {}
                Err(e) => { println!("error {e}"); break; }
            }
        }
    }).await;
    if r.is_err() { println!("timeout"); }
}
