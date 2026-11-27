//! TLS settings for broker connections: the OS trust store plus an optional
//! extra CA file, an optional client certificate, and an "insecure" mode that
//! skips server certificate checks (for brokers with throwaway certificates).

use std::sync::Arc;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme};
use serde::Deserialize;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TlsOptions {
    /// PEM file with extra CA certificates to trust (e.g. a self-signed broker CA).
    #[serde(default)]
    pub ca_file: Option<String>,
    /// PEM client certificate (chain) for brokers that require mutual TLS.
    #[serde(default)]
    pub client_cert_file: Option<String>,
    /// PEM private key matching `client_cert_file`.
    #[serde(default)]
    pub client_key_file: Option<String>,
    /// Accept any server certificate. Encrypts traffic but doesn't verify who
    /// is on the other end.
    #[serde(default)]
    pub insecure: bool,
}

fn non_empty(s: &Option<String>) -> Option<&str> {
    s.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

fn read_certs(path: &str, what: &str) -> Result<Vec<CertificateDer<'static>>, String> {
    let certs = CertificateDer::pem_file_iter(path)
        .map_err(|e| format!("Can't read {what} file {path}: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Invalid {what} file {path}: {e}"))?;
    if certs.is_empty() {
        return Err(format!("No certificates found in {what} file {path}"));
    }
    Ok(certs)
}

pub fn client_config(opts: &TlsOptions) -> Result<ClientConfig, String> {
    let builder = ClientConfig::builder();

    let builder = if opts.insecure {
        builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(AcceptAnyCert(provider())))
    } else {
        let mut roots = RootCertStore::empty();
        // Certificates the OS can't parse are skipped rather than fatal.
        let native = rustls_native_certs::load_native_certs();
        roots.add_parsable_certificates(native.certs);
        if let Some(path) = non_empty(&opts.ca_file) {
            for cert in read_certs(path, "CA")? {
                roots
                    .add(cert)
                    .map_err(|e| format!("Invalid CA certificate in {path}: {e}"))?;
            }
        }
        builder.with_root_certificates(roots)
    };

    match (non_empty(&opts.client_cert_file), non_empty(&opts.client_key_file)) {
        (None, None) => Ok(builder.with_no_client_auth()),
        (Some(cert), Some(key)) => {
            let chain = read_certs(cert, "client certificate")?;
            let key = PrivateKeyDer::from_pem_file(key)
                .map_err(|e| format!("Can't read client key file {key}: {e}"))?;
            builder
                .with_client_auth_cert(chain, key)
                .map_err(|e| format!("Client certificate and key don't work together: {e}"))
        }
        _ => Err("A client certificate needs both a certificate file and a key file".into()),
    }
}

fn provider() -> Arc<CryptoProvider> {
    CryptoProvider::get_default()
        .cloned()
        .unwrap_or_else(|| Arc::new(rustls::crypto::ring::default_provider()))
}

/// Skips certificate validation but still checks handshake signatures, so
/// the connection is encrypted to whoever holds the presented certificate.
#[derive(Debug)]
struct AcceptAnyCert(Arc<CryptoProvider>);

impl ServerCertVerifier for AcceptAnyCert {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}
