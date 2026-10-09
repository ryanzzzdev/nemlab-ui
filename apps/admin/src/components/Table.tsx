import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface Column<T> {
  id: string;
  header: string;
  align?: "right";
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  /** Shown when rows is empty (inside the scroll area). */
  empty?: ReactNode;
}

/**
 * Dense workspace table: sticky header, row selection that drives the
 * inspector and the role="grid" keyboard contract (arrows move,
 * Enter/Space selects, Home/End jump).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  selectedKey,
  onSelect,
  empty,
}: DataTableProps<T>) {
  const [focusIndex, setFocusIndex] = useState(0);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  const keys = useMemo(() => rows.map(rowKey), [rows, rowKey]);
  const selectedIndex = selectedKey ? keys.indexOf(selectedKey) : -1;

  useEffect(() => {
    setFocusIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [selectedIndex]);

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
              {columns.map((column) => (
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
                  {columns.map((column) => (
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
