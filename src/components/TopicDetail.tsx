import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { TopicNode } from "../topicTree";
import { collectLatest } from "../topicTree";
import type { MqttMessage } from "../types";
import { formatBytes, formatPayload, formatTime, previewPayload } from "../format";
import {
  diffJson,
  diffLines,
  fileStem,
  historyCsv,
  historyJson,
  messageRecord,
  numericSeries,
  parseJson,
  showJson,
} from "../analysis";
import { Sparkline } from "./Sparkline";

interface Props {
  node: TopicNode;
  onClearRetained: (topic: string) => void;
  onUseInPublish: (msg: MqttMessage) => void;
}

async function exportFile(defaultName: string, ext: "json" | "csv", contents: string) {
  const path = await save({
    title: "Export",
    defaultPath: `${defaultName}.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (path) await invoke("save_text_file", { path, contents });
}

export function TopicDetail({ node, onClearRetained, onUseInPublish }: Props) {
  // null = follow the latest message
  const [pinned, setPinned] = useState<MqttMessage | null>(null);
  const [comparing, setComparing] = useState(false);
  // The message to compare against; null = the one before the viewed message.
  const [base, setBase] = useState<MqttMessage | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setPinned(null);
    setBase(null);
    setField(null);
    setNote(null);
  }, [node.path]);

  const msg = pinned ?? node.message;
  const history = node.history;
  const msgIndex = msg ? history.lastIndexOf(msg) : -1;
  // Compare mode carries over between topics, but only applies where there's
  // something to compare.
  const diffing = comparing && history.length > 1;
  const compareTo = base ?? (msgIndex > 0 ? history[msgIndex - 1] : undefined);

  // node.count changes whenever a message arrives, so the chart stays live.
  const series = useMemo(() => numericSeries(history), [history, node.count]);
  const chart = series.find((s) => s.field === field) ?? series[0];

  const flash = (ok: boolean, text: string) => {
    setNote({ ok, text });
    setTimeout(() => setNote((n) => (n?.text === text ? null : n)), 2500);
  };
  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(
      () => flash(true, `Copied ${what}`),
      (e) => flash(false, String(e)),
    );
  const runExport = (p: Promise<void>) => p.catch((e) => flash(false, String(e)));

  return (
    <div className="detail">
      <div className="detail-header">
        <code className="topic-path">{node.path}</code>
        <button className="ghost small" onClick={() => copy(node.path, "topic")}>
          Copy topic
        </button>
        <span className="grow" />
        {note && <span className={"small " + (note.ok ? "ok" : "err")}>{note.text}</span>}
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

          {diffing ? (
            <DiffView before={compareTo} after={msg} />
          ) : (
            <ValueView msg={msg} />
          )}

          {msg.properties && <PropertiesView msg={msg} />}

          <div className="row tight actions wrap">
            <button
              className={"small" + (diffing ? " accent-btn" : "")}
              onClick={() => setComparing(!diffing)}
              disabled={history.length < 2}
              title="Show what changed between two messages"
            >
              {diffing ? "Done comparing" : "Compare"}
            </button>
            <button className="small" onClick={() => copy(msg.payload, msg.binary ? "value (base64)" : "value")}>
              Copy value
            </button>
            <button
              className="small"
              onClick={() => copy(JSON.stringify(messageRecord(msg), null, 2), "message as JSON")}
            >
              Copy as JSON
            </button>
            <button className="small" onClick={() => onUseInPublish(msg)} disabled={msg.binary}>
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

      {chart && (
        <section>
          <div className="section-head">
            <h3>Values</h3>
            {(series.length > 1 || chart.field) && (
              <select
                className="small-select"
                value={chart.field}
                onChange={(e) => setField(e.target.value)}
                aria-label="Field to chart"
              >
                {series.map((s) => (
                  <option key={s.field} value={s.field}>
                    {s.field || "(payload)"}
                  </option>
                ))}
              </select>
            )}
          </div>
          <Sparkline values={chart.values} times={chart.times} />
        </section>
      )}

      {history.length > 0 && (
        <section className="history">
          <div className="section-head">
            <h3>
              History <span className="muted small">(last {history.length})</span>
            </h3>
            <span className="grow" />
            <button
              className="ghost small"
              onClick={() => runExport(exportFile(fileStem(node.path), "json", historyJson(history)))}
            >
              Export JSON
            </button>
            <button
              className="ghost small"
              onClick={() => runExport(exportFile(fileStem(node.path), "csv", historyCsv(history)))}
            >
              Export CSV
            </button>
            {node.children.size > 0 && (
              <button
                className="ghost small"
                title="Latest message of every topic under this one"
                onClick={() =>
                  runExport(
                    exportFile(fileStem(node.path) + "-subtree", "json", historyJson(collectLatest(node))),
                  )
                }
              >
                Export subtree
              </button>
            )}
          </div>
          {diffing && (
            <p className="muted small hint">
              Comparing the viewed message with an earlier one. Click a history entry to compare against it instead.
            </p>
          )}
          <ul>
            {[...history].reverse().map((m, i) => (
              <li
                key={m.timestamp + ":" + i}
                className={(m === msg ? "active" : "") + (diffing && m === compareTo ? " base" : "")}
                onClick={() => {
                  if (diffing) setBase(m === msg ? null : m);
                  else setPinned(m === node.message ? null : m);
                }}
              >
                <span className="muted mono">{formatTime(m.timestamp)}</span>
                {diffing && m === compareTo && <span className="chip tiny">before</span>}
                {diffing && m === msg && <span className="chip tiny accent">after</span>}
                <span className="mono ellipsis">{previewPayload(m, 200)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!node.message && node.children.size > 0 && history.length === 0 && (
        <div className="row tight">
          <button
            className="small"
            title="Latest message of every topic under this one"
            onClick={() =>
              runExport(exportFile(fileStem(node.path) + "-subtree", "json", historyJson(collectLatest(node))))
            }
          >
            Export subtree
          </button>
        </div>
      )}
    </div>
  );
}

function PropertiesView({ msg }: { msg: MqttMessage }) {
  const p = msg.properties!;
  const rows: [string, string][] = [];
  if (p.contentType) rows.push(["Content type", p.contentType]);
  if (p.payloadFormat !== undefined) rows.push(["Payload format", p.payloadFormat === 1 ? "UTF-8" : "bytes"]);
  if (p.responseTopic) rows.push(["Response topic", p.responseTopic]);
  if (p.correlationData) rows.push(["Correlation data", p.correlationData]);
  if (p.messageExpiry !== undefined) rows.push(["Message expiry", `${p.messageExpiry} s`]);
  if (p.subscriptionIds?.length) rows.push(["Subscription IDs", p.subscriptionIds.join(", ")]);
  for (const [k, v] of p.userProperties ?? []) rows.push([k, v]);
  if (rows.length === 0) return null;
  return (
    <section>
      <h3>MQTT 5 properties</h3>
      <table className="kv">
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i}>
              <th>{k}</th>
              <td className="mono">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function DiffView({ before, after }: { before?: MqttMessage; after: MqttMessage }) {
  if (!before) return <pre className="value muted">No earlier message to compare with.</pre>;
  const header = (
    <div className="muted small diff-head">
      {formatTime(before.timestamp)} → {formatTime(after.timestamp)}
    </div>
  );
  const a = parseJson(before);
  const b = parseJson(after);
  if (a !== undefined && b !== undefined) {
    const changes = diffJson(a, b);
    return (
      <div className="diff">
        {header}
        {changes.length === 0 ? (
          <pre className="value muted">No changes.</pre>
        ) : (
          <table className="kv diff-table">
            <tbody>
              {changes.map((c) => (
                <tr key={c.kind + c.path} className={"d-" + c.kind}>
                  <th className="mono">{c.path || "(root)"}</th>
                  <td className="mono">
                    {c.kind !== "added" && <span className="d-old">{showJson(c.before)}</span>}
                    {c.kind === "changed" && " → "}
                    {c.kind !== "removed" && <span className="d-new">{showJson(c.after)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }
  const lines = diffLines(formatPayload(before).text, formatPayload(after).text);
  return (
    <div className="diff">
      {header}
      <pre className="value">
        {lines.map((l, i) => (
          <div key={i} className={"d-line d-" + l.kind}>
            {l.kind === "added" ? "+ " : l.kind === "removed" ? "- " : "  "}
            {l.text}
          </div>
        ))}
      </pre>
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
