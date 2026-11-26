# Tidepool

Tidepool is a cross-platform desktop MQTT explorer, native on Apple Silicon, Intel Macs, Windows and Linux.
It's built with [Tauri 2](https://tauri.app): a Rust MQTT client ([rumqttc](https://crates.io/crates/rumqttc)) with a React + TypeScript UI.

## Features

- Saved connection profiles (host, port, TLS, username/password, client ID, subscriptions)
- Live topic tree with per-branch topic and message counts, value previews, and a flash when a topic updates
- Filters topics and payloads as you type
- Topic detail: pretty-printed and highlighted JSON, hex view for binary payloads, QoS, retained flag, size, and the last 100 messages
- A chart for topics whose values are numeric
- Publish with QoS and retain, plus "edit & republish" and "clear retained"
- Pause the display, clear the tree, and see messages per second
- Handles busy brokers: messages go to the UI in 100 ms batches, and payloads can be up to 16 MB

## Development

Prerequisites: Node 20+, Rust (stable), and the [Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run tauri dev
```

## Building installers

```bash
npm run tauri build
```

The output goes to `src-tauri/target/release/bundle/`: `.app`/`.dmg` on macOS, `.msi`/`.exe` on Windows, and `.deb`/`.AppImage`/`.rpm` on Linux.
Each OS builds its own installers, so use CI (for example `tauri-apps/tauri-action`) to produce all three.

For a universal macOS build (Apple Silicon + Intel):

```bash
rustup target add x86_64-apple-darwin aarch64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
```

## Connectivity check

`src-tauri/examples/` has two small CLI tools for checking a broker without the UI:

```bash
cd src-tauri
cargo run --example smoke -- test.mosquitto.org 1883          # plain
cargo run --example smoke -- test.mosquitto.org 8886 tls      # TLS
cargo run --example burst -- <host> some/topic 500 1          # publish 500 numbered msgs at QoS 1
```

## Notes

- Subscriptions use QoS 0. On a very busy broker, the broker itself may drop messages if the client can't keep up with the bandwidth. Narrow the subscriptions (for example `zigbee2mqtt/#` instead of `#`) to see everything.
- If you choose "Remember password", the password is stored unencrypted in the app's local storage.
- TLS uses the OS trust store. Client certificates and self-signed CAs aren't supported yet.

## License

[MIT](LICENSE) © 2026 Sal Zaydon
