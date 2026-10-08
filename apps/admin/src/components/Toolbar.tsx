import type { ReactNode } from "react";

/** Workspace chrome matching the prototype: scope toolbar, summary
 * strip of stats, and the underline tab row. */

export function Toolbar({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="toolbar">
      <h1>{title}</h1>
      {children}
    </div>
  );
}

export function StatStrip({ children }: { children: ReactNode }) {
  return <div className="strip">{children}</div>;
}

export function Stat({
  value,
  label,
  tone,
  onClick,
}: {
  value: ReactNode;
  label: string;
  tone?: "warn" | "ok" | undefined;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="stat" onClick={onClick} disabled={!onClick}>
      <b className={tone ? tone : undefined}>{value}</b>
      <span>{label}</span>
    </button>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (tab: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          className={`tab${tab.id === active ? " active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
