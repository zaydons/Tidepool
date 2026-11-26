import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ConnStatus, ConnectionProfile, MqttMessage } from "./types";
import { createNode, findNode, insertMessage, type TopicNode } from "./topicTree";
import { loadProfiles, saveProfiles } from "./profiles";
import { ConnectionForm } from "./components/ConnectionForm";
import { TopicTree } from "./components/TopicTree";
import { TopicDetail } from "./components/TopicDetail";
import { PublishPanel, type PublishDraft } from "./components/PublishPanel";
import "./styles.css";

export default function App() {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>(loadProfiles);
  const [active, setActive] = useState<ConnectionProfile | null>(null);
  const [status, setStatus] = useState<ConnStatus>({ state: "idle" });
  const [connectError, setConnectError] = useState<string>();

  const rootRef = useRef<TopicNode>(createNode("", ""));
  const [, setVersion] = useState(0);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [rate, setRate] = useState(0);
  const [split, setSplit] = useState(48);
  const [pub, setPub] = useState<PublishDraft>({ topic: "", payload: "", qos: 0, retain: false });

  const updateProfiles = (list: ConnectionProfile[]) => {
    setProfiles(list);
    saveProfiles(list);
  };

  // Backend events
  useEffect(() => {
    const unsubs = [
      listen<MqttMessage[]>("mqtt-messages", (e) => {
        const root = rootRef.current;
        for (const m of e.payload) insertMessage(root, m);
        if (!pausedRef.current) setVersion((v) => v + 1);
      }),
      listen<ConnStatus>("mqtt-status", (e) => setStatus(e.payload)),
    ];
    return () => {
      unsubs.forEach((p) => p.then((f) => f()));
    };
  }, []);

  // Messages-per-second meter
  useEffect(() => {
    let prev = rootRef.current.totalCount;
    const id = setInterval(() => {
      const now = rootRef.current.totalCount;
      setRate(Math.max(0, now - prev));
      prev = now;
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  const connect = async (p: ConnectionProfile) => {
    setConnectError(undefined);
    rootRef.current = createNode("", "");
    setExpanded(new Set());
    setSelected(null);
    setFilter("");
    setActive(p);
    setStatus({ state: "connecting" });
    try {
      await invoke("mqtt_connect", {
        config: {
          host: p.host,
          port: p.port,
          tls: p.tls,
          username: p.username || null,
          password: p.password || null,
          clientId: p.clientId || null,
          subscriptions: p.subscriptions.map((s) => s.trim()).filter(Boolean),
        },
      });
    } catch (err) {
      setActive(null);
      setStatus({ state: "idle" });
      setConnectError(String(err));
    }
  };

  const disconnect = async () => {
    await invoke("mqtt_disconnect");
    setActive(null);
    setStatus({ state: "idle" });
  };

  const publish = useCallback(async (d: PublishDraft) => {
    await invoke("mqtt_publish", { req: d });
  }, []);

  const toggle = (path: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(path) ? n.delete(path) : n.add(path);
      return n;
    });

  const selectTopic = (path: string) => {
    setSelected(path);
    setPub((d) => ({ ...d, topic: path }));
  };

  const expandAll = (open: boolean) => {
    if (!open) return setExpanded(new Set());
    const all = new Set<string>();
    const walk = (n: TopicNode) => {
      for (const c of n.children.values()) {
        if (c.children.size) {
          all.add(c.path);
          walk(c);
        }
      }
    };
    walk(rootRef.current);
    setExpanded(all);
  };

  const clearTree = () => {
    rootRef.current = createNode("", "");
    setSelected(null);
    setVersion((v) => v + 1);
  };

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const parent = (e.currentTarget as HTMLElement).parentElement!;
    const rect = parent.getBoundingClientRect();
    const move = (ev: MouseEvent) =>
      setSplit(Math.min(80, Math.max(20, ((ev.clientX - rect.left) / rect.width) * 100)));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  if (!active) {
    return (
      <ConnectionForm profiles={profiles} onChange={updateProfiles} onConnect={connect} error={connectError} />
    );
  }

  const root = rootRef.current;
  const selectedNode = selected !== null ? findNode(root, selected) : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <div className="conn-info">
          <StatusDot status={status} />
          <div>
            <div className="conn-name">{active.name}</div>
            <div className="muted small">
              {active.tls ? "mqtts" : "mqtt"}://{active.host}:{active.port}
            </div>
          </div>
        </div>
        <div className="stats muted small">
          <span>
            <strong>{root.topicCount.toLocaleString()}</strong> topics
          </span>
          <span>
            <strong>{root.totalCount.toLocaleString()}</strong> messages
          </span>
          <span>
            <strong>{rate}</strong> msg/s
          </span>
        </div>
        <input
          className="search"
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Filter topics & values…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="row tight">
          <button
            className={"small" + (paused ? " accent-btn" : "")}
            onClick={() => {
              pausedRef.current = !paused;
              setPaused(!paused);
              if (paused) setVersion((v) => v + 1);
            }}
            title="Freeze the display (messages are still recorded)"
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button className="small" onClick={clearTree} title="Forget all received messages">
            Clear
          </button>
          <button className="small danger" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      </header>

      {status.state === "reconnecting" && (
        <div className="banner">Connection problem — retrying: {status.error}</div>
      )}

      <main className="split">
        <section className="pane tree-pane" style={{ width: `${split}%` }}>
          <div className="pane-toolbar">
            <button className="ghost small" onClick={() => expandAll(true)}>
              Expand all
            </button>
            <button className="ghost small" onClick={() => expandAll(false)}>
              Collapse all
            </button>
          </div>
          <div className="scroll">
            <TopicTree
              root={root}
              expanded={expanded}
              onToggle={toggle}
              selected={selected}
              onSelect={selectTopic}
              filter={filter}
            />
          </div>
        </section>
        <div className="divider" onMouseDown={startDrag} />
        <section className="pane detail-pane">
          <div className="scroll">
            {selectedNode ? (
              <TopicDetail
                node={selectedNode}
                onClearRetained={(t) => publish({ topic: t, payload: "", qos: 0, retain: true })}
                onUseInPublish={(topic, payload) => setPub((d) => ({ ...d, topic, payload }))}
              />
            ) : (
              <div className="empty muted">Select a topic to see its value and history.</div>
            )}
          </div>
          <PublishPanel
            draft={pub}
            onChange={setPub}
            onPublish={publish}
            disabled={status.state !== "connected"}
          />
        </section>
      </main>
    </div>
  );
}

function StatusDot({ status }: { status: ConnStatus }) {
  const label = {
    idle: "Idle",
    connecting: "Connecting…",
    connected: "Connected",
    reconnecting: "Reconnecting…",
    disconnected: "Disconnected",
  }[status.state];
  return <span className={"status-dot " + status.state} title={label} aria-label={label} />;
}
