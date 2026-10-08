import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

interface DrawerProps {
  title: string;
  open: boolean;
  onClose: () => void;
  wide?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Right-side modal drawer (load data / review & publish). Escape and the
 * close button both dismiss; focus moves into the drawer on open and back
 * to the opener on close.
 */
export function Drawer({ title, open, onClose, wide, footer, children }: DrawerProps) {
  const ref = useRef<HTMLElement>(null);
  const previousFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement;
    const node = ref.current;
    node?.querySelector<HTMLElement>("button, input, select, [tabindex]")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (previousFocus.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <aside
      ref={ref}
      className={`drawer${wide ? " wide" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="drawer-head">
        {title}
        <button type="button" className="close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="drawer-body">{children}</div>
      {footer && <div className="drawer-foot">{footer}</div>}
    </aside>,
    document.body,
  );
}
