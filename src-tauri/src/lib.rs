mod mqtt;

/// How this copy of the app was installed, which decides how it can update:
/// - "macos" / "appimage" / "windows": the built-in updater can replace the app in place.
/// - "linux-package": installed from a .deb/.rpm, owned by the system package
///   manager, so the app can only point the user at the new download.
#[tauri::command]
fn install_kind() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        // The AppImage runtime sets $APPIMAGE to the image's path.
        if std::env::var_os("APPIMAGE").is_some() {
            "appimage"
        } else {
            "linux-package"
        }
    } else {
        "other"
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The MQTT client and the updater share rustls; pick its crypto backend
    // explicitly so TLS never has to guess (it panics if it's ambiguous).
    let _ = rustls::crypto::ring::default_provider().install_default();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .manage(mqtt::MqttState::default())
        .invoke_handler(tauri::generate_handler![
            install_kind,
            mqtt::mqtt_connect,
            mqtt::mqtt_disconnect,
            mqtt::mqtt_publish,
            mqtt::mqtt_subscribe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
