// Publish N numbered messages: cargo run --example burst -- <host> <topic> <n> <qos>
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
#[tokio::main(flavor = "current_thread")]
async fn main() {
    let a: Vec<String> = std::env::args().collect();
    let n: u32 = a[3].parse().unwrap();
    let qos = if a[4] == "1" { QoS::AtLeastOnce } else { QoS::AtMostOnce };
    let (c, mut el) = AsyncClient::new(MqttOptions::new(format!("burst-{}", std::process::id()), a[1].clone(), 1883), 1000);
    let t = a[2].clone();
    tokio::spawn(async move { for i in 1..=n { c.publish(&t, qos, false, i.to_string()).await.unwrap(); } c.disconnect().await.unwrap(); });
    let mut acks = 0;
    loop { match el.poll().await { Ok(Event::Incoming(Packet::PubAck(_))) => acks += 1, Ok(Event::Outgoing(rumqttc::Outgoing::Disconnect)) => break, Err(e) => { println!("err {e}"); break } _ => {} } }
    println!("sent {n}, pubacks {acks}");
}
