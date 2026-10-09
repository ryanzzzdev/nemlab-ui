import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface Column<T> {
  id: string;
  header: string;
  align?: "right";
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  /** Stable per-table identity — column visibility persists under it. */
  id: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  /** Shown when rows is empty (inside the scroll area). */
  empty?: ReactNode;
}

function readHidden(id: string, columns: Column<unknown>[]): Set<string> {
  try {
    const raw = localStorage.getItem(`nemlab-admin-columns:${id}`);
    const valid = new Set(columns.map((c) => c.id));
    const stored = new Set((JSON.parse(raw ?? "[]") as string[]).filter((k) => valid.has(k)));
    // Never allow hiding every column — a blank grid is unusable.
    return stored.size >= columns.length ? new Set() : stored;
  } catch {
    return new Set();
  }
}

/**
 * Dense workspace table: sticky header, row selection that drives the
 * inspector, per-table column visibility and the role="grid" keyboard
 * contract (arrows move, Enter/Space selects, Home/End jump).
 */
export function DataTable<T>({
  id,
  columns,
  rows,
  rowKey,
  selectedKey,
  onSelect,
  empty,
}: DataTableProps<T>) {
  const [hidden, setHidden] = useState<Set<string>>(() =>
    readHidden(id, columns as Column<unknown>[]),
  );
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  const visible = useMemo(() => columns.filter((c) => !hidden.has(c.id)), [columns, hidden]);
  const keys = useMemo(() => rows.map(rowKey), [rows, rowKey]);
  const selectedIndex = selectedKey ? keys.indexOf(selectedKey) : -1;

  useEffect(() => {
    setFocusIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [selectedIndex]);

  const toggleColumn = (columnId: string) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(columnId)) next.delete(columnId);
      else if (next.size < columns.length - 1) next.add(columnId);
      try {
        localStorage.setItem(`nemlab-admin-columns:${id}`, JSON.stringify([...next]));
      } catch {
        // Visibility is a convenience — fine to keep it session-only.
      }
      return next;
    });
  };

  const moveFocus = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(rows.length - 1, index));
      setFocusIndex(clamped);
      bodyRef.current?.querySelectorAll("tr")[clamped]?.scrollIntoView({ block: "nearest" });
    },
    [rows.length],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!rows.length) return;
    if (event.key === "ArrowDown") moveFocus(focusIndex + 1);
    else if (event.key === "ArrowUp") moveFocus(focusIndex - 1);
    else if (event.key === "Home") moveFocus(0);
    else if (event.key === "End") moveFocus(rows.length - 1);
    else if (event.key === "Enter" || event.key === " ") {
      const key = keys[focusIndex];
      if (key !== undefined) onSelect?.(key);
    } else return;
    event.preventDefault();
  };

  return (
    <div className="table-wrap">
      <div className="table-actions">
        <button
          type="button"
          className="mini-btn"
          aria-expanded={columnsOpen}
          title="Choose which columns this table shows."
          onClick={() => setColumnsOpen((open) => !open)}
        >
          Columns
        </button>
        {columnsOpen && (
          <div className="columns-menu" role="group" aria-label="Visible columns">
            {columns.map((column) => (
              <label key={column.id}>
                <input
                  type="checkbox"
                  checked={!hidden.has(column.id)}
                  disabled={!hidden.has(column.id) && visible.length === 1}
                  onChange={() => toggleColumn(column.id)}
                />
                {column.header}
              </label>
            ))}
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        (empty ?? <p className="empty-insp">Nothing to show.</p>)
      ) : (
        <table
          className="grid"
          role="grid"
          aria-rowcount={rows.length}
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          <thead>
            <tr>
              {visible.map((column) => (
                <th key={column.id} className={column.align === "right" ? "num" : undefined}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {rows.map((row, index) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  className={
                    key === selectedKey ? "sel" : index === focusIndex ? "focus" : undefined
                  }
                  aria-selected={key === selectedKey}
                  onClick={() => onSelect?.(key)}
                  onMouseEnter={() => setFocusIndex(index)}
                >
                  {visible.map((column) => (
                    <td key={column.id} className={column.align === "right" ? "num" : undefined}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
