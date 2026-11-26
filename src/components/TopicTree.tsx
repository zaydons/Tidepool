import type { TopicNode } from "../topicTree";
import { matchesFilter, sortedChildren } from "../topicTree";
import { previewPayload } from "../format";

interface Props {
  root: TopicNode;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selected: string | null;
  onSelect: (path: string) => void;
  filter: string;
}

export function TopicTree({ root, expanded, onToggle, selected, onSelect, filter }: Props) {
  const q = filter.trim().toLowerCase();
  const cache = new Map<TopicNode, boolean>();
  const children = sortedChildren(root).filter((c) => !q || matchesFilter(c, q, cache));

  if (root.children.size === 0) {
    return <div className="empty muted">Waiting for messages…</div>;
  }
  if (children.length === 0) {
    return <div className="empty muted">No topics match “{filter}”.</div>;
  }

  return (
    <ul className="tree" role="tree">
      {children.map((c) => (
        <Row
          key={c.path}
          node={c}
          depth={0}
          expanded={expanded}
          onToggle={onToggle}
          selected={selected}
          onSelect={onSelect}
          q={q}
          cache={cache}
        />
      ))}
    </ul>
  );
}

interface RowProps {
  node: TopicNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selected: string | null;
  onSelect: (path: string) => void;
  q: string;
  cache: Map<TopicNode, boolean>;
}

function Row({ node, depth, expanded, onToggle, selected, onSelect, q, cache }: RowProps) {
  const hasChildren = node.children.size > 0;
  // While filtering, auto-expand so matches are visible.
  const isOpen = hasChildren && (q ? true : expanded.has(node.path));
  const kids = isOpen
    ? sortedChildren(node).filter((c) => !q || matchesFilter(c, q, cache))
    : [];

  return (
    <li role="treeitem" aria-expanded={hasChildren ? isOpen : undefined}>
      <div
        className={"tree-row" + (selected === node.path ? " selected" : "")}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => onSelect(node.path)}
        onDoubleClick={() => hasChildren && onToggle(node.path)}
      >
        <span
          className={"caret" + (hasChildren ? "" : " leaf")}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggle(node.path);
          }}
        >
          {hasChildren ? (isOpen ? "▾" : "▸") : ""}
        </span>
        {/* key on lastUpdate remounts the span, replaying the flash animation */}
        <span key={node.lastUpdate} className="tree-name flash">
          {node.name === "" ? <em className="muted">(empty)</em> : node.name}
        </span>
        {node.message && (
          <span className="tree-value" title={node.message.binary ? undefined : node.message.payload}>
            = {previewPayload(node.message)}
          </span>
        )}
        {hasChildren && (
          <span className="tree-meta muted">
            {node.topicCount} topics · {node.totalCount} msgs
          </span>
        )}
      </div>
      {kids.length > 0 && (
        <ul role="group">
          {kids.map((c) => (
            <Row
              key={c.path}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selected={selected}
              onSelect={onSelect}
              q={q}
              cache={cache}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
