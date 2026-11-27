# Tidepool

Tidepool is a cross-platform desktop MQTT explorer, native on Apple Silicon, Intel Macs, Windows and Linux.
It's built with [Tauri 2](https://tauri.app): a Rust MQTT client ([rumqttc](https://crates.io/crates/rumqttc)) with a React + TypeScript UI.

## Features

- Saved connection profiles; remembered passwords are kept in the system keychain (macOS Keychain, or GNOME Keyring / KWallet on Linux)
- MQTT 3.1.1 and MQTT 5, including MQTT 5 message properties (content type, response topic, correlation data, user properties, expiry)
- TLS with the system's trusted certificates, your own CA certificate (for self-signed brokers), client certificates, or no verification at all
- QoS 0, 1 or 2 per subscription
- Live topic tree with per-branch topic and message counts, value previews, and a flash when a topic updates
- Filters topics and payloads as you type
- Topic detail: pretty-printed and highlighted JSON, hex view for binary payloads, QoS, retained flag, size, and the last 100 messages
- Compare any two messages on a topic: field-by-field for JSON, line-by-line for text
- Charts for numeric topics and for any numeric field inside JSON payloads (e.g. `temperature` from a zigbee2mqtt sensor)
- Copy a topic, value or whole message, and export a topic's history (JSON or CSV) or the latest values of a whole subtree
- Keyboard: ⌘F / Ctrl+F filters, arrow keys move through the tree (→ opens, ← closes or goes up), Escape clears the filter
- Publish with QoS, retain and MQTT 5 properties, plus "edit & republish" and "clear retained"
- Pause the display, clear the tree, and see messages per second
- Handles busy brokers: messages go to the UI in 100 ms batches, and payloads can be up to 16 MB

## Install

Download the installer for your system from the [Releases page](https://github.com/zaydons/Tidepool/releases).

| System | File |
| --- | --- |
| macOS 11+ (Apple Silicon and Intel) | `Tidepool_<version>_universal.dmg` |
| Linux Mint, Ubuntu, Debian, Pop!_OS, elementary | `.deb`: `amd64` for PCs, `arm64` for ARM boards |
| Fedora, openSUSE, RHEL | `.rpm`: `x86_64` or `aarch64` |
| Any other Linux | `.AppImage`: `amd64` or `aarch64` |

### macOS

Open the `.dmg` and drag Tidepool to Applications.
The app isn't notarized by Apple, so the first launch is blocked. To allow it:

1. Open Tidepool once and dismiss the warning.
2. Go to **System Settings → Privacy & Security** and click **Open Anyway** next to the Tidepool message.

Alternatively, run `/usr/bin/xattr -dr com.apple.quarantine /Applications/Tidepool.app` once in Terminal.

### Linux Mint / Ubuntu / Debian

Double-click the `.deb` to open it in the package installer, or run:

```bash
sudo apt install ./Tidepool_*_amd64.deb
```

Tidepool then appears in the menu under **Programming**. You need Mint 21 or later, Ubuntu 22.04 or later, or Debian 12 or later.

### Fedora / openSUSE

```bash
sudo dnf install ./Tidepool-*.x86_64.rpm
```

### AppImage (any distro)

```bash
chmod +x Tidepool_*.AppImage
./Tidepool_*.AppImage
```

## Updates

Tidepool checks for a new version when it starts and every few hours while it's open. You can also click **Check for updates** at the bottom of the Connections sidebar.

- **macOS and AppImage:** click **Install and restart** in the banner. Tidepool downloads the update, verifies its signature and relaunches.
- **`.deb` / `.rpm`:** the banner links to the new release. Download it and install it the same way as the first time. The package manager owns these installs, so the app can't replace itself.

## Releasing a new version

1. Bump `version` in `package.json` (for example `npm version minor --no-git-tag-version`). The app reads its version from there.
2. Commit and push to `main`.
3. GitHub Actions sees the new version, tags the commit (for example `v0.2.0`), builds every installer, signs the update files and creates a **draft** release with them attached. Check it on the Releases page, then click **Publish**.
   Installed apps only see the update once the release is published, because drafts aren't served as "latest".

Pushes to `main` that don't change the version don't build anything. Pull requests and manual runs still build the installers, but don't release them.

### Update signing key (one-time setup)

Updates are signed so that only you can publish them. The key lives in two places:

- `~/.tauri/tidepool.key` on your Mac, plus a backup somewhere safe such as a password manager. **If you lose it, existing installs can't receive updates anymore.**
- The `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets in the GitHub repository.

The matching public key is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. Never commit the private key; `.gitignore` blocks `*.key` files.

Every pull request and manual run (**Actions → Build installers → Run workflow**) also builds all installers. You can download them from that run's **Artifacts** section.

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

The output goes to `src-tauri/target/release/bundle/`: `.app`/`.dmg` on macOS and `.deb`/`.rpm`/`.AppImage` on Linux.
Each OS can only build its own installers. The [build workflow](.github/workflows/build.yml) produces the macOS and Linux installers on GitHub Actions.

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
cargo run --example smoke -- test.mosquitto.org 1883 --v5     # MQTT 5
cargo run --example smoke -- broker.lan 8883 --ca ca.pem --cert client.pem --key client.key
cargo run --example burst -- <host> some/topic 500 1          # publish 500 numbered msgs at QoS 1
```

## Notes

- On a very busy broker, QoS 0 subscriptions can lose messages when the client can't keep up. Use QoS 1 for the topics you care about, or narrow the subscriptions (for example `zigbee2mqtt/#` instead of `#`).
- "Remember password" saves the password in the system keychain. On macOS, the first time a new version of Tidepool reads it, macOS asks for permission; choose **Always Allow**. On Linux it needs a Secret Service provider (GNOME Keyring or KWallet), which Mint, Ubuntu and Fedora desktops include.
- Versions before 0.2 stored remembered passwords in plain text. Tidepool 0.2 moves them into the keychain on first launch and removes the plain-text copies.
- Certificate and key files must be PEM. "Don't verify the server certificate" still encrypts the connection but can't detect an impostor broker, so prefer adding the broker's CA certificate.

## License

[MIT](LICENSE) © 2026 Sal Zaydon
