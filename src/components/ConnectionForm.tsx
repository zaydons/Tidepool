import { useState } from "react";
import type { ConnectionProfile } from "../types";
import { newProfile } from "../profiles";

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

  const select = (p: ConnectionProfile) => {
    setSelectedId(p.id);
    setDraft(p);
  };

  const set = <K extends keyof ConnectionProfile>(k: K, v: ConnectionProfile[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const persist = (p: ConnectionProfile) => {
    const exists = profiles.some((x) => x.id === p.id);
    onChange(exists ? profiles.map((x) => (x.id === p.id ? p : x)) : [...profiles, p]);
    setSelectedId(p.id);
  };

  const remove = () => {
    const next = profiles.filter((x) => x.id !== draft.id);
    onChange(next);
    const first = next[0] ?? newProfile();
    setSelectedId(first.id);
    setDraft(first);
  };

  const addNew = () => {
    const p = newProfile();
    setSelectedId(p.id);
    setDraft(p);
  };

  const connect = (e: React.FormEvent) => {
    e.preventDefault();
    const p = { ...draft, name: draft.name.trim() || draft.host };
    persist(p);
    onConnect(p);
  };

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
          Use TLS (system trusted certificates)
        </label>

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
          Remember password <span className="muted small">(stored unencrypted on this computer)</span>
        </label>

        <label>
          Client ID <span className="muted small">(blank = random)</span>
          <input value={draft.clientId} onChange={(e) => set("clientId", e.target.value)} />
        </label>

        <label>
          Subscriptions <span className="muted small">(one per line)</span>
          <textarea
            rows={3}
            value={draft.subscriptions.join("\n")}
            onChange={(e) => set("subscriptions", e.target.value.split("\n"))}
          />
        </label>

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
