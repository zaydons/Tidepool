import { useState } from "react";

export interface PublishDraft {
  topic: string;
  payload: string;
  qos: number;
  retain: boolean;
}

interface Props {
  draft: PublishDraft;
  onChange: (d: PublishDraft) => void;
  onPublish: (d: PublishDraft) => Promise<void>;
  disabled: boolean;
}

export function PublishPanel({ draft, onChange, onPublish, disabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof PublishDraft>(k: K, v: PublishDraft[K]) => onChange({ ...draft, [k]: v });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
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
        <span className="grow" />
        {note && <span className={"small " + (note.ok ? "ok" : "err")}>{note.text}</span>}
        <button type="submit" className="primary" disabled={disabled || busy} title="⌘/Ctrl + Enter">
          Publish
        </button>
      </div>
    </form>
  );
}
