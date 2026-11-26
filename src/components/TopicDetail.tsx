import { useEffect, useState } from "react";
import type { TopicNode } from "../topicTree";
import type { MqttMessage } from "../types";
import { formatBytes, formatPayload, formatTime, previewPayload } from "../format";
import { Sparkline } from "./Sparkline";

interface Props {
  node: TopicNode;
  onClearRetained: (topic: string) => void;
  onUseInPublish: (topic: string, payload: string) => void;
}

export function TopicDetail({ node, onClearRetained, onUseInPublish }: Props) {
  // null = follow the latest message
  const [pinned, setPinned] = useState<MqttMessage | null>(null);
  useEffect(() => setPinned(null), [node.path]);

  const msg = pinned ?? node.message;
  const history = node.history;
  const numeric = history.length > 1 && history.every((m) => !m.binary && m.payload.trim() !== "" && isFinite(Number(m.payload)));

  return (
    <div className="detail">
      <div className="detail-header">
        <code className="topic-path">{node.path}</code>
        <button className="ghost small" onClick={() => navigator.clipboard.writeText(node.path)}>
          Copy topic
        </button>
      </div>

      {!node.message && (
        <p className="muted">
          No message on this exact topic. Subtree: {node.topicCount} topics, {node.totalCount} messages.
        </p>
      )}

      {msg && (
        <>
          <div className="chips">
            {pinned && (
              <button className="chip warn" onClick={() => setPinned(null)}>
                Viewing older message — back to latest
              </button>
            )}
            <span className="chip">{formatTime(msg.timestamp)}</span>
            <span className="chip">QoS {msg.qos}</span>
            {msg.retain && <span className="chip accent">retained</span>}
            <span className="chip">{formatBytes(msg.size)}</span>
            <span className="chip">{node.count} received</span>
          </div>
          <ValueView msg={msg} />
          <div className="row actions">
            <button
              className="small"
              onClick={() => navigator.clipboard.writeText(msg.binary ? msg.payload : msg.payload)}
            >
              Copy value
            </button>
            <button className="small" onClick={() => onUseInPublish(node.path, msg.binary ? "" : msg.payload)}>
              Edit &amp; republish
            </button>
            {node.message?.retain && (
              <button
                className="small danger ghost"
                title="Publishes an empty retained message to remove it from the broker"
                onClick={() => {
                  if (confirm(`Clear the retained message on “${node.path}”?`)) onClearRetained(node.path);
                }}
              >
                Clear retained
              </button>
            )}
          </div>
        </>
      )}

      {numeric && (
        <section>
          <h3>Values</h3>
          <Sparkline values={history.map((m) => Number(m.payload))} times={history.map((m) => m.timestamp)} />
        </section>
      )}

      {history.length > 0 && (
        <section className="history">
          <h3>
            History <span className="muted small">(last {history.length})</span>
          </h3>
          <ul>
            {[...history].reverse().map((m, i) => (
              <li
                key={m.timestamp + ":" + i}
                className={m === msg ? "active" : ""}
                onClick={() => setPinned(m === node.message ? null : m)}
              >
                <span className="muted mono">{formatTime(m.timestamp)}</span>
                <span className="mono ellipsis">{previewPayload(m, 200)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ValueView({ msg }: { msg: MqttMessage }) {
  const { text, kind } = formatPayload(msg);
  if (kind === "empty") return <pre className="value muted">(empty payload)</pre>;
  return (
    <pre className={"value " + kind}>
      {kind === "json" ? <JsonHighlight text={text} /> : text}
    </pre>
  );
}

const TOKEN = /("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function JsonHighlight({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const cls = m[1] ? "j-key" : m[2] ? "j-str" : m[3] ? "j-lit" : "j-num";
    out.push(
      <span key={i++} className={cls}>
        {m[0]}
      </span>,
    );
    last = idx + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}
