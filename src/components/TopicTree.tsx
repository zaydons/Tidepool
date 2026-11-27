import { forwardRef, useEffect, useRef } from "react";
import type { VisibleRow } from "../topicTree";
import { previewPayload } from "../format";

interface Props {
  rows: VisibleRow[];
  /** True when the broker has sent nothing yet (as opposed to a filter hiding everything). */
  empty: boolean;
  filter: string;
  selected: string | null;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}

/**
 * The topic tree. Keyboard: ↑/↓ move, → opens or goes to the first child,
 * ← closes or goes to the parent, Enter/Space toggles, Home/End jump.
 */
export const TopicTree = forwardRef<HTMLUListElement, Props>(function TopicTree(
  { rows, empty, filter, selected, onSelect, onToggle },
  ref,
) {
  const selectedRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (empty) return <div className="empty muted">Waiting for messages…</div>;
  if (rows.length === 0) return <div className="empty muted">No topics match “{filter}”.</div>;

  const index = rows.findIndex((r) => r.node.path === selected);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const go = (i: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (r) onSelect(r.node.path);
    };
    const row = rows[index];
    let handled = true;
    switch (e.key) {
      case "ArrowDown":
        go(index < 0 ? 0 : index + 1);
        break;
      case "ArrowUp":
        go(index < 0 ? 0 : index - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(rows.length - 1);
        break;
      case "PageDown":
        go(index + 20);
        break;
      case "PageUp":
        go(index - 20);
        break;
      case "ArrowRight":
        if (!row) go(0);
        else if (row.hasChildren && !row.open) onToggle(row.node.path);
        else if (row.open) go(index + 1);
        break;
      case "ArrowLeft":
        if (!row) break;
        if (row.open && !filter.trim()) onToggle(row.node.path);
        else {
          // Parent = nearest row above with a smaller depth.
          for (let i = index - 1; i >= 0; i--) {
            if (rows[i].depth < row.depth) {
              go(i);
              break;
            }
          }
        }
        break;
      case "Enter":
      case " ":
        if (row?.hasChildren) onToggle(row.node.path);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };

  return (
    <ul
      ref={ref}
      className="tree"
      role="tree"
      tabIndex={0}
      aria-label="Topics"
      aria-activedescendant={index >= 0 ? `topic-row-${index}` : undefined}
      onKeyDown={onKeyDown}
    >
      {rows.map(({ node, depth, hasChildren, open }, i) => (
        <li
          key={node.path + "\u0000" + depth}
          id={`topic-row-${i}`}
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={hasChildren ? open : undefined}
          aria-selected={selected === node.path}
        >
          <div
            ref={selected === node.path ? selectedRow : undefined}
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
              {hasChildren ? (open ? "▾" : "▸") : ""}
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
        </li>
      ))}
    </ul>
  );
});
