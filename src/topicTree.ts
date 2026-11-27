import type { MqttMessage } from "./types";

export const HISTORY_LIMIT = 100;

export interface TopicNode {
  name: string;
  /** Full topic path; "" for the root. */
  path: string;
  children: Map<string, TopicNode>;
  /** Latest message published to exactly this topic. */
  message?: MqttMessage;
  history: MqttMessage[];
  /** Messages received on exactly this topic. */
  count: number;
  /** Messages received on this topic and all descendants. */
  totalCount: number;
  /** Number of descendant topics (any depth) that carry a message. */
  topicCount: number;
  /** Time of the most recent message in this subtree. */
  lastUpdate: number;
}

export function createNode(name: string, path: string): TopicNode {
  return {
    name,
    path,
    children: new Map(),
    history: [],
    count: 0,
    totalCount: 0,
    topicCount: 0,
    lastUpdate: 0,
  };
}

/**
 * Insert a message, mutating the tree in place.
 * An empty retained payload means "retained message cleared": the topic's
 * value is removed (mirrors what the broker does) but history is kept.
 */
export function insertMessage(root: TopicNode, msg: MqttMessage): void {
  const parts = msg.topic.split("/");
  const chain: TopicNode[] = [root];
  let node = root;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    let child = node.children.get(part);
    if (!child) {
      child = createNode(part, parts.slice(0, i + 1).join("/"));
      node.children.set(part, child);
    }
    node = child;
    chain.push(node);
  }

  const isNewTopic = node.count === 0;
  node.count++;
  node.message = msg;
  node.history.push(msg);
  if (node.history.length > HISTORY_LIMIT) node.history.shift();

  for (const n of chain) {
    n.totalCount++;
    n.lastUpdate = msg.timestamp;
    if (isNewTopic && n !== node) n.topicCount++;
  }
}

export function findNode(root: TopicNode, path: string): TopicNode | undefined {
  // A topic like "/foo" has an empty first level whose path is also "".
  if (path === "") return root.children.get("") ?? root;
  let node: TopicNode | undefined = root;
  for (const part of path.split("/")) {
    node = node.children.get(part);
    if (!node) return undefined;
  }
  return node;
}

export function sortedChildren(node: TopicNode): TopicNode[] {
  return [...node.children.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  );
}

/** True if this node or any descendant's path contains `q` (lower-cased). */
export function matchesFilter(node: TopicNode, q: string, cache: Map<TopicNode, boolean>): boolean {
  const cached = cache.get(node);
  if (cached !== undefined) return cached;
  let hit = node.path.toLowerCase().includes(q);
  if (!hit && node.message && !node.message.binary) {
    hit = node.message.payload.toLowerCase().includes(q);
  }
  if (!hit) {
    for (const c of node.children.values()) {
      if (matchesFilter(c, q, cache)) {
        hit = true;
        break;
      }
    }
  }
  cache.set(node, hit);
  return hit;
}

/** The latest message of every topic in this subtree, in tree order. */
export function collectLatest(node: TopicNode, out: MqttMessage[] = []): MqttMessage[] {
  if (node.message) out.push(node.message);
  for (const c of sortedChildren(node)) collectLatest(c, out);
  return out;
}

export interface VisibleRow {
  node: TopicNode;
  depth: number;
  hasChildren: boolean;
  open: boolean;
}

/**
 * The rows the tree currently shows, top to bottom. While filtering, every
 * branch with a match is open so matches are visible.
 */
export function visibleRows(root: TopicNode, expanded: Set<string>, filter: string): VisibleRow[] {
  const q = filter.trim().toLowerCase();
  const cache = new Map<TopicNode, boolean>();
  const rows: VisibleRow[] = [];
  const walk = (n: TopicNode, depth: number) => {
    for (const c of sortedChildren(n)) {
      if (q && !matchesFilter(c, q, cache)) continue;
      const hasChildren = c.children.size > 0;
      const open = hasChildren && (q ? true : expanded.has(c.path));
      rows.push({ node: c, depth, hasChildren, open });
      if (open) walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

