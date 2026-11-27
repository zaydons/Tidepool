//! Broker passwords in the OS credential store: Keychain on macOS, Secret
//! Service (GNOME Keyring / KWallet) on Linux, Credential Manager on Windows.
//! Entries are keyed by connection profile ID.

use keyring::{Entry, Error};

const SERVICE: &str = "com.zaydons.tidepool";

fn entry(profile_id: &str) -> Result<Entry, String> {
    if profile_id.trim().is_empty() {
        return Err("Missing profile ID".into());
    }
    Entry::new(SERVICE, profile_id).map_err(describe)
}

fn describe(e: Error) -> String {
    match e {
        Error::NoDefaultStore | Error::NoStorageAccess(_) | Error::PlatformFailure(_) => format!(
            "The system keychain isn't available ({e}). On Linux this needs GNOME Keyring or KWallet."
        ),
        other => other.to_string(),
    }
}

/// Returns the saved password, or null if none is saved.
#[tauri::command]
pub async fn secret_get(profile_id: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || match entry(&profile_id)?.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(describe(e)),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn secret_set(profile_id: String, password: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        entry(&profile_id)?.set_password(&password).map_err(describe)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Deleting a password that was never saved is not an error.
#[tauri::command]
pub async fn secret_delete(profile_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || match entry(&profile_id)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(describe(e)),
    })
    .await
    .map_err(|e| e.to_string())?
}
