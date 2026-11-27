import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { ConnectionProfile, Subscription } from "../types";
import { deleteSecret, getSecret, newProfile, rememberSecret } from "../profiles";

interface Props {
  profiles: ConnectionProfile[];
  onChange: (list: ConnectionProfile[]) => void;
  onConnect: (p: ConnectionProfile) => void;
  error?: string;
  footer?: React.ReactNode;
}

export function ConnectionForm({ profiles, onChange, onConnect, error, footer }: Props) {
  const [selectedId, setSelectedId] = useState<string>(profiles[0]?.id ?? "");
  const [draft, setDraft] = useState<ConnectionProfile>(
    () => profiles.find((p) => p.id === selectedId) ?? newProfile(),
  );
  const [keychainError, setKeychainError] = useState<string>();

  // Fill in the saved password from the keychain when a profile is opened.
  const draftId = draft.id;
  const wantsSecret = draft.rememberPassword && !draft.password;
  useEffect(() => {
    if (!wantsSecret) return;
    let cancelled = false;
    getSecret(draftId)
      .then((pw) => {
        if (!cancelled && pw) setDraft((d) => (d.id === draftId && !d.password ? { ...d, password: pw } : d));
      })
      .catch((e) => !cancelled && setKeychainError(String(e)));
    return () => {
      cancelled = true;
    };
    // Only when switching profiles, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  const select = (p: ConnectionProfile) => {
    setKeychainError(undefined);
    setSelectedId(p.id);
    setDraft(p);
  };

  const set = <K extends keyof ConnectionProfile>(k: K, v: ConnectionProfile[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const persist = async (p: ConnectionProfile) => {
    const exists = profiles.some((x) => x.id === p.id);
    onChange(exists ? profiles.map((x) => (x.id === p.id ? p : x)) : [...profiles, p]);
    setSelectedId(p.id);
    try {
      await rememberSecret(p);
      setKeychainError(undefined);
    } catch (e) {
      setKeychainError(String(e));
    }
  };

  const remove = () => {
    const next = profiles.filter((x) => x.id !== draft.id);
    onChange(next);
    deleteSecret(draft.id).catch(() => {});
    const first = next[0] ?? newProfile();
    select(first);
  };

  const addNew = () => select(newProfile());

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = {
      ...draft,
      name: draft.name.trim() || draft.host,
      subscriptions: draft.subscriptions.filter((s) => s.topic.trim()),
    };
    await persist(p);
    onConnect(p);
  };

  const pickFile = async (k: "caFile" | "clientCertFile" | "clientKeyFile", title: string) => {
    const path = await open({
      title,
      multiple: false,
      directory: false,
      filters: [{ name: "PEM files", extensions: ["pem", "crt", "cer", "key"] }, { name: "All files", extensions: ["*"] }],
    });
    if (typeof path === "string") set(k, path);
  };

  const setSub = (i: number, s: Partial<Subscription>) =>
    set(
      "subscriptions",
      draft.subscriptions.map((x, j) => (j === i ? { ...x, ...s } : x)),
    );

  return (
    <div className="connect-screen">
      <aside className="profile-list">
        <div className="profile-list-header">
          <span>Connections</span>
          <button className="ghost" onClick={addNew} title="New connection">
            +
          </button>
        </div>
        {profiles.length === 0 && <p className="muted small pad">No saved connections yet.</p>}
        {profiles.map((p) => (
          <button
            key={p.id}
            className={"profile-item" + (p.id === selectedId ? " active" : "")}
            onClick={() => select(p)}
          >
            <span className="profile-name">{p.name}</span>
            <span className="muted small">
              {p.tls ? "mqtts" : "mqtt"}://{p.host}:{p.port}
              {p.protocol === 5 ? " · v5" : ""}
            </span>
          </button>
        ))}
        <div className="grow" />
        {footer}
      </aside>

      <form className="connect-form" onSubmit={connect}>
        <h1>Connect to a broker</h1>

        <label>
          Name
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </label>

        <div className="row">
          <label className="grow">
            Host
            <input
              required
              autoFocus
              placeholder="homeassistant.local or 192.168.1.10"
              value={draft.host}
              onChange={(e) => set("host", e.target.value)}
            />
          </label>
          <label style={{ width: 110 }}>
            Port
            <input
              type="number"
              min={1}
              max={65535}
              value={draft.port}
              onChange={(e) => set("port", Number(e.target.value))}
            />
          </label>
          <label style={{ width: 130 }}>
            Protocol
            <select value={draft.protocol} onChange={(e) => set("protocol", Number(e.target.value) as 4 | 5)}>
              <option value={4}>MQTT 3.1.1</option>
              <option value={5}>MQTT 5</option>
            </select>
          </label>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={draft.tls}
            onChange={(e) => {
              const tls = e.target.checked;
              setDraft((d) => ({
                ...d,
                tls,
                port: d.port === 1883 && tls ? 8883 : d.port === 8883 && !tls ? 1883 : d.port,
              }));
            }}
          />
          Use TLS
        </label>

        {draft.tls && (
          <fieldset className="tls-options">
            <FileField
              label="CA certificate"
              hint="trusted in addition to the system's certificates"
              value={draft.caFile}
              disabled={draft.tlsInsecure}
              onChange={(v) => set("caFile", v)}
              onBrowse={() => pickFile("caFile", "Choose the broker's CA certificate")}
            />
            <FileField
              label="Client certificate"
              hint="only if the broker requires one"
              value={draft.clientCertFile}
              onChange={(v) => set("clientCertFile", v)}
              onBrowse={() => pickFile("clientCertFile", "Choose your client certificate")}
            />
            <FileField
              label="Client key"
              value={draft.clientKeyFile}
              onChange={(v) => set("clientKeyFile", v)}
              onBrowse={() => pickFile("clientKeyFile", "Choose your client private key")}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={draft.tlsInsecure}
                onChange={(e) => set("tlsInsecure", e.target.checked)}
              />
              Don't verify the server certificate
            </label>
            {draft.tlsInsecure && (
              <p className="warn-text small">
                Traffic is still encrypted, but Tidepool can't tell whether it's talking to your broker or an
                impostor. Use a CA certificate instead when you can.
              </p>
            )}
          </fieldset>
        )}

        <div className="row">
          <label className="grow">
            Username
            <input
              autoComplete="off"
              value={draft.username}
              onChange={(e) => set("username", e.target.value)}
            />
          </label>
          <label className="grow">
            Password
            <input
              type="password"
              autoComplete="off"
              value={draft.password}
              onChange={(e) => set("password", e.target.value)}
            />
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.rememberPassword}
            onChange={(e) => set("rememberPassword", e.target.checked)}
          />
          Remember password <span className="muted small">(saved in the system keychain)</span>
        </label>
        {keychainError && <div className="error-box">{keychainError}</div>}

        <label>
          Client ID <span className="muted small">(blank = random)</span>
          <input value={draft.clientId} onChange={(e) => set("clientId", e.target.value)} />
        </label>

        <div className="field">
          <span className="field-label">
            Subscriptions{" "}
            <span className="muted small">(QoS 1 or 2 asks the broker not to drop messages to Tidepool)</span>
          </span>
          {draft.subscriptions.map((s, i) => (
            <div className="row tight" key={i}>
              <input
                className="grow mono"
                placeholder="topic/# or sensors/+/temperature"
                value={s.topic}
                onChange={(e) => setSub(i, { topic: e.target.value })}
              />
              <select
                value={s.qos}
                onChange={(e) => setSub(i, { qos: Number(e.target.value) })}
                aria-label="QoS"
                title="QoS"
              >
                <option value={0}>QoS 0</option>
                <option value={1}>QoS 1</option>
                <option value={2}>QoS 2</option>
              </select>
              <button
                type="button"
                className="ghost small"
                title="Remove subscription"
                onClick={() =>
                  set(
                    "subscriptions",
                    draft.subscriptions.filter((_, j) => j !== i),
                  )
                }
              >
                ✕
              </button>
            </div>
          ))}
          <div>
            <button
              type="button"
              className="small"
              onClick={() => set("subscriptions", [...draft.subscriptions, { topic: "", qos: 0 }])}
            >
              Add subscription
            </button>
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}

        <div className="row actions">
          <button type="submit" className="primary">
            Connect
          </button>
          <button type="button" onClick={() => persist(draft)}>
            Save
          </button>
          {profiles.some((p) => p.id === draft.id) && (
            <button type="button" className="danger ghost" onClick={remove}>
              Delete
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

interface FileFieldProps {
  label: string;
  hint?: string;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  onBrowse: () => void;
}

function FileField({ label, hint, value, disabled, onChange, onBrowse }: FileFieldProps) {
  return (
    <label>
      <span>
        {label} {hint && <span className="muted small">({hint})</span>}
      </span>
      <div className="row tight">
        <input
          className="grow mono"
          placeholder="Path to a .pem file"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="small" onClick={onBrowse} disabled={disabled}>
          Browse…
        </button>
        {value && (
          <button type="button" className="ghost small" title="Clear" onClick={() => onChange("")} disabled={disabled}>
            ✕
          </button>
        )}
      </div>
    </label>
  );
}
