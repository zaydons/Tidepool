import type { MqttMessage } from "./types";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Parses a message payload as JSON, or returns undefined. */
export function parseJson(msg: MqttMessage): Json | undefined {
  if (msg.binary || msg.size === 0) return undefined;
  const t = msg.payload.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return undefined;
  try {
    return JSON.parse(t) as Json;
  } catch {
    return undefined;
  }
}

/**
 * Flattens JSON into leaf paths like `state`, `color.x` or `list[2].id`.
 * Empty objects and arrays count as leaves so they still show up in diffs.
 */
export function flatten(value: Json, prefix = "", out = new Map<string, Json>()): Map<string, Json> {
  if (Array.isArray(value)) {
    if (value.length === 0) out.set(prefix, value);
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) out.set(prefix, value);
    for (const k of keys) flatten(value[k], prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, value);
  }
  return out;
}

// ---------- Charts ----------

/** A chartable series: the whole payload ("") or a numeric JSON field. */
export interface Series {
  field: string;
  values: number[];
  times: number[];
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return undefined;
}

/**
 * Every series in a topic's history with at least two points: the payload
 * itself when it's a plain number, and each numeric (or boolean) JSON field.
 */
export function numericSeries(history: MqttMessage[]): Series[] {
  const plain: Series = { field: "", values: [], times: [] };
  const fields = new Map<string, Series>();
  for (const m of history) {
    if (m.binary) continue;
    const t = m.payload.trim();
    if (t !== "" && isFinite(Number(t))) {
      plain.values.push(Number(t));
      plain.times.push(m.timestamp);
      continue;
    }
    const json = parseJson(m);
    if (json === undefined || json === null || typeof json !== "object") continue;
    for (const [path, v] of flatten(json)) {
      const n = asNumber(v);
      if (n === undefined) continue;
      let s = fields.get(path);
      if (!s) fields.set(path, (s = { field: path, values: [], times: [] }));
      s.values.push(n);
      s.times.push(m.timestamp);
    }
  }
  const all = [plain, ...fields.values()].filter((s) => s.values.length >= 2);
  // Fields whose value actually changes are the interesting ones; list them first.
  const varies = (s: Series) => s.values.some((v) => v !== s.values[0]);
  return all.sort((a, b) => Number(varies(b)) - Number(varies(a)));
}

// ---------- Diff ----------

export type FieldChange =
  | { kind: "added"; path: string; after: Json }
  | { kind: "removed"; path: string; before: Json }
  | { kind: "changed"; path: string; before: Json; after: Json };

/** Field-by-field differences between two JSON values. */
export function diffJson(before: Json, after: Json): FieldChange[] {
  const a = flatten(before);
  const b = flatten(after);
  const changes: FieldChange[] = [];
  for (const [path, av] of a) {
    if (!b.has(path)) changes.push({ kind: "removed", path, before: av });
    else if (JSON.stringify(av) !== JSON.stringify(b.get(path)))
      changes.push({ kind: "changed", path, before: av, after: b.get(path)! });
  }
  for (const [path, bv] of b) if (!a.has(path)) changes.push({ kind: "added", path, after: bv });
  return changes;
}

export type LineChange = { kind: "same" | "added" | "removed"; text: string };

/** Line diff (longest common subsequence). Large inputs fall back to a plain before/after. */
export function diffLines(before: string, after: string): LineChange[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length * b.length > 4_000_000) {
    return [
      ...a.map((text) => ({ kind: "removed" as const, text })),
      ...b.map((text) => ({ kind: "added" as const, text })),
    ];
  }
  // lcs[i][j] = LCS length of a[i:] and b[j:]
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: LineChange[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: "removed", text: a[i++] });
    else out.push({ kind: "added", text: b[j++] });
  }
  while (i < a.length) out.push({ kind: "removed", text: a[i++] });
  while (j < b.length) out.push({ kind: "added", text: b[j++] });
  return out;
}

export function showJson(v: Json | undefined): string {
  return v === undefined ? "" : JSON.stringify(v);
}

// ---------- Export ----------

/** A message as plain JSON, with the payload parsed when it's JSON. */
export function messageRecord(m: MqttMessage) {
  const json = parseJson(m);
  return {
    topic: m.topic,
    time: new Date(m.timestamp).toISOString(),
    qos: m.qos,
    retain: m.retain,
    size: m.size,
    ...(m.binary ? { payloadBase64: m.payload } : json !== undefined ? { payload: json } : { payload: m.payload }),
    ...(m.properties ? { properties: m.properties } : {}),
  };
}

export function historyJson(history: MqttMessage[]): string {
  return JSON.stringify(history.map(messageRecord), null, 2) + "\n";
}

function csvCell(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function historyCsv(history: MqttMessage[]): string {
  const rows = [["time", "topic", "qos", "retain", "size", "encoding", "payload"]];
  for (const m of history) {
    rows.push([
      new Date(m.timestamp).toISOString(),
      m.topic,
      String(m.qos),
      String(m.retain),
      String(m.size),
      m.binary ? "base64" : "utf8",
      m.payload,
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

/** File-name-safe version of a topic. */
export function fileStem(topic: string): string {
  return topic.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "topic";
}
