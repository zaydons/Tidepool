// Local TLS front for testing the app's TLS options against a real broker:
//   cargo run --example tlsproxy -- <listen-port> <server.pem> <server.key>
//                                   [--client-ca ca.pem] [--upstream host:port]
// Terminates TLS (optionally requiring a client certificate signed by
// --client-ca) and forwards plain MQTT to the upstream broker
// (default test.mosquitto.org:1883).
use std::sync::Arc;

use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::server::WebPkiClientVerifier;
use rustls::{RootCertStore, ServerConfig};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsAcceptor;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let value = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned());
    let port = &args[0];
    let certs: Vec<CertificateDer> = CertificateDer::pem_file_iter(&args[1]).unwrap().map(Result::unwrap).collect();
    let key = PrivateKeyDer::from_pem_file(&args[2]).unwrap();
    let upstream = value("--upstream").unwrap_or("test.mosquitto.org:1883".into());

    let builder = ServerConfig::builder();
    let config = match value("--client-ca") {
        Some(ca) => {
            let mut roots = RootCertStore::empty();
            for c in CertificateDer::pem_file_iter(&ca).unwrap() {
                roots.add(c.unwrap()).unwrap();
            }
            let verifier = WebPkiClientVerifier::builder(Arc::new(roots)).build().unwrap();
            builder.with_client_cert_verifier(verifier)
        }
        None => builder.with_no_client_auth(),
    }
    .with_single_cert(certs, key)
    .unwrap();

    let acceptor = TlsAcceptor::from(Arc::new(config));
    let listener = TcpListener::bind(format!("127.0.0.1:{port}")).await.unwrap();
    println!("listening on 127.0.0.1:{port} -> {upstream}");
    loop {
        let (sock, peer) = listener.accept().await.unwrap();
        let acceptor = acceptor.clone();
        let upstream = upstream.clone();
        tokio::spawn(async move {
            let mut tls = match acceptor.accept(sock).await {
                Ok(t) => t,
                Err(e) => return println!("{peer}: handshake rejected: {e}"),
            };
            let client_cert = tls.get_ref().1.peer_certificates().is_some();
            println!("{peer}: handshake ok (client cert: {client_cert})");
            let mut up = TcpStream::connect(&upstream).await.unwrap();
            let _ = tokio::io::copy_bidirectional(&mut tls, &mut up).await;
        });
    }
}
