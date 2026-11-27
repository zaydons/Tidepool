import { useState } from "react";

export interface PublishDraft {
  topic: string;
  payload: string;
  qos: number;
  retain: boolean;
  /** MQTT 5 only. */
  contentType: string;
  responseTopic: string;
  /** Seconds, as typed; blank = never expires. */
  messageExpiry: string;
  /** One `key=value` per line. */
  userProperties: string;
}

export const emptyDraft: PublishDraft = {
  topic: "",
  payload: "",
  qos: 0,
  retain: false,
  contentType: "",
  responseTopic: "",
  messageExpiry: "",
  userProperties: "",
};

/** The `mqtt_publish` request for a draft. */
export function publishRequest(d: PublishDraft, mqtt5: boolean) {
  const base = { topic: d.topic, payload: d.payload, qos: d.qos, retain: d.retain };
  if (!mqtt5) return base;
  const userProperties = d.userProperties
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("=");
      return i < 0 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    });
  const expiry = d.messageExpiry.trim();
  return {
    ...base,
    properties: {
      contentType: d.contentType.trim() || null,
      responseTopic: d.responseTopic.trim() || null,
      messageExpiry: expiry ? Number(expiry) : null,
      userProperties,
    },
  };
}

interface Props {
  draft: PublishDraft;
  onChange: (d: PublishDraft) => void;
  onPublish: (d: PublishDraft) => Promise<void>;
  disabled: boolean;
  mqtt5: boolean;
}

export function PublishPanel({ draft, onChange, onPublish, disabled, mqtt5 }: Props) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [showProps, setShowProps] = useState(false);
  const set = <K extends keyof PublishDraft>(k: K, v: PublishDraft[K]) => onChange({ ...draft, [k]: v });

  const expiryInvalid = draft.messageExpiry.trim() !== "" && !/^\d+$/.test(draft.messageExpiry.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mqtt5 && expiryInvalid) {
      setNote({ ok: false, text: "Message expiry must be a whole number of seconds" });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await onPublish(draft);
      setNote({ ok: true, text: "Published" });
    } catch (err) {
      setNote({ ok: false, text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const formatJson = () => {
    try {
      set("payload", JSON.stringify(JSON.parse(draft.payload), null, 2));
    } catch {
      setNote({ ok: false, text: "Payload is not valid JSON" });
    }
  };

  const propCount = [draft.contentType, draft.responseTopic, draft.messageExpiry, draft.userProperties].filter((v) =>
    v.trim(),
  ).length;

  return (
    <form className="publish" onSubmit={submit}>
      <h3>Publish</h3>
      <input
        placeholder="topic/to/publish"
        value={draft.topic}
        onChange={(e) => set("topic", e.target.value)}
        required
      />
      <textarea
        rows={4}
        placeholder="payload"
        className="mono"
        value={draft.payload}
        onChange={(e) => set("payload", e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
        }}
      />
      {mqtt5 && showProps && (
        <div className="props-grid">
          <label>
            Content type
            <input
              placeholder="application/json"
              value={draft.contentType}
              onChange={(e) => set("contentType", e.target.value)}
            />
          </label>
          <label>
            Response topic
            <input value={draft.responseTopic} onChange={(e) => set("responseTopic", e.target.value)} />
          </label>
          <label>
            Expiry (s)
            <input
              inputMode="numeric"
              placeholder="never"
              className={expiryInvalid ? "invalid" : ""}
              value={draft.messageExpiry}
              onChange={(e) => set("messageExpiry", e.target.value)}
            />
          </label>
          <label className="span-all">
            User properties <span className="muted small">(key=value, one per line)</span>
            <textarea
              rows={2}
              className="mono"
              value={draft.userProperties}
              onChange={(e) => set("userProperties", e.target.value)}
            />
          </label>
        </div>
      )}
      <div className="row">
        <label className="inline">
          QoS
          <select value={draft.qos} onChange={(e) => set("qos", Number(e.target.value))}>
            <option value={0}>0</option>
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.retain} onChange={(e) => set("retain", e.target.checked)} />
          Retain
        </label>
        <button type="button" className="ghost small" onClick={formatJson}>
          Format JSON
        </button>
        {mqtt5 && (
          <button
            type="button"
            className={"ghost small" + (showProps ? " accent-btn" : "")}
            onClick={() => setShowProps((s) => !s)}
          >
            Properties{propCount ? ` (${propCount})` : ""}
          </button>
        )}
        <span className="grow" />
        {note && <span className={"small " + (note.ok ? "ok" : "err")}>{note.text}</span>}
        <button type="submit" className="primary" disabled={disabled || busy} title="⌘/Ctrl + Enter">
          Publish
        </button>
      </div>
    </form>
  );
}
