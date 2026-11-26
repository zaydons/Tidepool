import type { MqttMessage } from "./types";

export function formatPayload(msg: MqttMessage): { text: string; kind: "json" | "text" | "binary" | "empty" } {
  if (msg.size === 0) return { text: "", kind: "empty" };
  if (msg.binary) {
    const bytes = Uint8Array.from(atob(msg.payload), (c) => c.charCodeAt(0));
    const hex = [...bytes.slice(0, 4096)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
    return { text: hex + (bytes.length > 4096 ? " …" : ""), kind: "binary" };
  }
  const t = msg.payload.trim();
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      return { text: JSON.stringify(JSON.parse(t), null, 2), kind: "json" };
    } catch {
      /* not JSON */
    }
  }
  return { text: msg.payload, kind: "text" };
}

export function previewPayload(msg: MqttMessage, max = 80): string {
  if (msg.size === 0) return "∅";
  if (msg.binary) return `<${formatBytes(msg.size)} binary>`;
  const oneLine = msg.payload.replace(/\s+/g, " ");
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatTime(ms: number): string {
  const d = new Date(ms);
  return (
    d.toLocaleTimeString(undefined, { hour12: false }) +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

export function formatAgo(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ms).toLocaleDateString();
}
