// Publish N numbered messages and wait for the broker to acknowledge them:
//   cargo run --example burst -- <host> <topic> <n> <qos 0|1>
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
use std::time::Duration;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let a: Vec<String> = std::env::args().collect();
    let n: u32 = a[3].parse().unwrap();
    let qos = if a[4] == "1" { QoS::AtLeastOnce } else { QoS::AtMostOnce };
    let mut opts = MqttOptions::new(format!("burst-{}", std::process::id()), a[1].clone(), 1883);
    opts.set_inflight(100);
    let (c, mut el) = AsyncClient::new(opts, 1000);
    let t = a[2].clone();
    let pc = c.clone();
    tokio::spawn(async move {
        for i in 1..=n {
            pc.publish(&t, qos, false, i.to_string()).await.unwrap();
        }
    });
    let mut acks = 0;
    let mut sent = 0;
    let done = tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            match el.poll().await {
                Ok(Event::Incoming(Packet::PubAck(_))) => acks += 1,
                Ok(Event::Outgoing(rumqttc::Outgoing::Publish(_))) => sent += 1,
                Err(e) => {
                    println!("error {e}");
                    break;
                }
                _ => {}
            }
            let finished = if qos == QoS::AtMostOnce { sent == n } else { acks == n };
            if finished {
                break;
            }
        }
    })
    .await;
    let _ = c.try_disconnect();
    if done.is_err() {
        println!("timed out");
    }
    println!("sent {sent}/{n}, pubacks {acks}");
}
