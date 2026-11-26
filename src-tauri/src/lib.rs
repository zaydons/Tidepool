mod mqtt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(mqtt::MqttState::default())
        .invoke_handler(tauri::generate_handler![
            mqtt::mqtt_connect,
            mqtt::mqtt_disconnect,
            mqtt::mqtt_publish,
            mqtt::mqtt_subscribe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
