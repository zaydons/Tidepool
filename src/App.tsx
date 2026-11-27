import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ConnStatus, ConnectionProfile, MqttMessage } from "./types";
import { createNode, findNode, insertMessage, visibleRows, type TopicNode } from "./topicTree";
import { loadProfiles, migratePlaintextPasswords, saveProfiles } from "./profiles";
import { ConnectionForm } from "./components/ConnectionForm";
import { TopicTree } from "./components/TopicTree";
import { TopicDetail } from "./components/TopicDetail";
import { PublishPanel, emptyDraft, publishRequest, type PublishDraft } from "./components/PublishPanel";
import { UpdateBanner } from "./components/UpdateBanner";
import { useUpdates } from "./updates";
import "./styles.css";

export default function App() {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  // Profiles load after any 0.1-era plain-text passwords move to the keychain.
  const [ready, setReady] = useState(false);
  const [migrationError, setMigrationError] = useState<string>();
  const [active, setActive] = useState<ConnectionProfile | null>(null);
  const [status, setStatus] = useState<ConnStatus>({ state: "idle" });
  const [connectError, setConnectError] = useState<string>();
  const updates = useUpdates();

  const rootRef = useRef<TopicNode>(createNode("", ""));
  const [, setVersion] = useState(0);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [rate, setRate] = useState(0);
  const [split, setSplit] = useState(48);
  const [pub, setPub] = useState<PublishDraft>(emptyDraft);
  const filterRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    migratePlaintextPasswords()
      .then(setMigrationError)
      .finally(() => {
        setProfiles(loadProfiles());
        setReady(true);
      });
  }, []);

  // ⌘F / Ctrl+F: jump to the filter.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        filterRef.current?.focus();
        filterRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

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
          tlsOptions: {
            caFile: p.caFile || null,
            clientCertFile: p.clientCertFile || null,
            clientKeyFile: p.clientKeyFile || null,
            insecure: p.tlsInsecure,
          },
          protocol: p.protocol,
          username: p.username || null,
          password: p.password || null,
          clientId: p.clientId || null,
          subscriptions: p.subscriptions
            .map((s) => ({ topic: s.topic.trim(), qos: s.qos }))
            .filter((s) => s.topic),
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

  const mqtt5 = active?.protocol === 5;
  const publish = useCallback(
    async (d: PublishDraft) => {
      await invoke("mqtt_publish", { req: publishRequest(d, mqtt5) });
    },
    [mqtt5],
  );

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
    if (!ready) return <div className="shell" />;
    return (
      <div className="shell">
        <UpdateBanner updates={updates} />
        {migrationError && (
          <div className="banner">
            Saved passwords couldn't be moved to the system keychain, so they were removed. Enter them again. (
            {migrationError})
          </div>
        )}
        <ConnectionForm
          profiles={profiles}
          onChange={updateProfiles}
          onConnect={connect}
          error={connectError}
          footer={
            <div className="sidebar-footer muted small">
              <span>Tidepool {updates.currentVersion}</span>
              <button className="ghost small" onClick={() => updates.checkNow(true)}>
                Check for updates
              </button>
            </div>
          }
        />
      </div>
    );
  }

  const root = rootRef.current;
  const selectedNode = selected !== null ? findNode(root, selected) : undefined;
  const rows = visibleRows(root, expanded, filter);

  return (
    <div className="app">
      <UpdateBanner updates={updates} />
      <header className="topbar">
        <div className="conn-info">
          <StatusDot status={status} />
          <div>
            <div className="conn-name">{active.name}</div>
            <div className="muted small">
              {active.tls ? "mqtts" : "mqtt"}://{active.host}:{active.port}
              {mqtt5 ? " · MQTT 5" : ""}
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
          placeholder="Filter topics & values… (⌘F)"
          ref={filterRef}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setFilter("");
              treeRef.current?.focus();
            } else if (e.key === "ArrowDown" || e.key === "Enter") {
              e.preventDefault();
              if (rows[0] && !rows.some((r) => r.node.path === selected)) selectTopic(rows[0].node.path);
              treeRef.current?.focus();
            }
          }}
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
              ref={treeRef}
              rows={rows}
              empty={root.children.size === 0}
              filter={filter}
              selected={selected}
              onSelect={selectTopic}
              onToggle={toggle}
            />
          </div>
        </section>
        <div className="divider" onMouseDown={startDrag} />
        <section className="pane detail-pane">
          <div className="scroll">
            {selectedNode ? (
              <TopicDetail
                node={selectedNode}
                onClearRetained={(t) => publish({ ...emptyDraft, topic: t, retain: true })}
                onUseInPublish={(m) =>
                  setPub((d) => ({
                    ...d,
                    topic: m.topic,
                    payload: m.payload,
                    qos: m.qos,
                    retain: m.retain,
                    contentType: m.properties?.contentType ?? "",
                    responseTopic: m.properties?.responseTopic ?? "",
                    messageExpiry: "",
                    userProperties: (m.properties?.userProperties ?? []).map(([k, v]) => `${k}=${v}`).join("\n"),
                  }))
                }
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
            mqtt5={mqtt5}
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
