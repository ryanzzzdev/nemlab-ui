import { useCallback } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { LAYOUT_LIMITS, useLayoutPrefs } from "../prefs";

/**
 * Resizable pane separators. Pointer drag adjusts the stored size; the
 * handle is also a `role="separator"` so arrows resize and Home restores
 * the default — the keyboard contract the redesign spec requires.
 */

function useHandleKeys(apply: (delta: number, reset?: boolean) => void, horizontal: boolean) {
  return useCallback(
    (event: KeyboardEvent) => {
      const step = event.shiftKey ? 48 : 16;
      const keys = horizontal
        ? { back: "ArrowLeft", forward: "ArrowRight" }
        : { back: "ArrowUp", forward: "ArrowDown" };
      if (event.key === keys.back) apply(-step);
      else if (event.key === keys.forward) apply(step);
      else if (event.key === "Home") apply(0, true);
      else return;
      event.preventDefault();
    },
    [apply, horizontal],
  );
}

function dragStart(event: PointerEvent<HTMLDivElement>, apply: (delta: number) => void) {
  event.preventDefault();
  const start = event.clientX ?? event.clientY;
  let last = start;
  const move = (e: globalThis.PointerEvent) => {
    const pos = event.currentTarget.dataset.axis === "y" ? e.clientY : e.clientX;
    apply(pos - last);
    last = pos;
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
}

export function Inspector({ children }: { children: ReactNode }) {
  const { prefs, update } = useLayoutPrefs();
  const apply = useCallback(
    (delta: number, reset = false) =>
      update({ inspectorWidth: reset ? 360 : prefs.inspectorWidth - delta }),
    [prefs.inspectorWidth, update],
  );
  const onKey = useHandleKeys(apply, true);
  return (
    <>
      <div
        className="split-handle v"
        role="separator"
        aria-orientation="vertical"
        aria-label="Inspector width"
        aria-valuenow={prefs.inspectorWidth}
        aria-valuemin={LAYOUT_LIMITS.inspectorWidth.min}
        aria-valuemax={LAYOUT_LIMITS.inspectorWidth.max}
        tabIndex={0}
        data-axis="x"
        onPointerDown={(e) => dragStart(e, apply)}
        onDoubleClick={() => apply(0, true)}
        onKeyDown={onKey}
      />
      <aside
        className="inspector"
        style={{ width: prefs.inspectorWidth }}
        aria-label="Selection inspector"
      >
        {children}
      </aside>
    </>
  );
}

export function ActivityPane({ scope, children }: { scope?: string; children: ReactNode }) {
  const { prefs, update, reset } = useLayoutPrefs();
  const apply = useCallback(
    (delta: number, resetSize = false) =>
      update({ activityHeight: resetSize ? 220 : prefs.activityHeight - delta }),
    [prefs.activityHeight, update],
  );
  const onKey = useHandleKeys(apply, false);
  return (
    <div
      className={`activity${prefs.activityCollapsed ? " collapsed" : ""}`}
      style={{ height: prefs.activityCollapsed ? undefined : prefs.activityHeight }}
    >
      <div
        className="split-handle h"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Activity pane height"
        aria-valuenow={prefs.activityHeight}
        aria-valuemin={LAYOUT_LIMITS.activityHeight.min}
        aria-valuemax={LAYOUT_LIMITS.activityHeight.max}
        tabIndex={0}
        data-axis="y"
        onPointerDown={(e) => dragStart(e, apply)}
        onDoubleClick={() => apply(0, true)}
        onKeyDown={onKey}
      />
      <div className="activity-head">
        <span>Activity</span>
        {scope && <span className="scope">{scope}</span>}
        <span className="spacer" />
        <button type="button" className="mini-btn" onClick={reset}>
          Reset layout
        </button>
        <button
          type="button"
          className="mini-btn"
          onClick={() => update({ activityCollapsed: !prefs.activityCollapsed })}
        >
          {prefs.activityCollapsed ? "Expand" : "Collapse"}
        </button>
      </div>
      <div className="activity-body">{children}</div>
    </div>
  );
}
