import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

/**
 * Admin layout and appearance preferences. Everything stored here is
 * presentation-only — never names, emails, tokens or query content.
 * One localStorage entry holds the whole layout so "Reset layout" is a
 * single delete.
 */

export type Theme = "auto" | "light" | "dark";
export type Density = "compact" | "standard" | "comfortable";

const THEME_KEY = "nemlab-theme";
const LAYOUT_KEY = "nemlab-admin-layout";

export interface LayoutPrefs {
  density: Density;
  inspectorWidth: number;
  activityHeight: number;
  activityCollapsed: boolean;
}

export const LAYOUT_LIMITS = {
  inspectorWidth: { min: 280, max: 560 },
  activityHeight: { min: 96, max: 480 },
} as const;

const DEFAULT_LAYOUT: LayoutPrefs = {
  density: "standard",
  inspectorWidth: 360,
  activityHeight: 220,
  activityCollapsed: false,
};

function readLayout(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<LayoutPrefs>;
    return {
      density: ["compact", "standard", "comfortable"].includes(parsed.density ?? "")
        ? (parsed.density as Density)
        : DEFAULT_LAYOUT.density,
      inspectorWidth: clamp(
        parsed.inspectorWidth ?? DEFAULT_LAYOUT.inspectorWidth,
        LAYOUT_LIMITS.inspectorWidth,
      ),
      activityHeight: clamp(
        parsed.activityHeight ?? DEFAULT_LAYOUT.activityHeight,
        LAYOUT_LIMITS.activityHeight,
      ),
      activityCollapsed: parsed.activityCollapsed === true,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function clamp(value: number, { min, max }: { min: number; max: number }): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function writeLayout(next: LayoutPrefs) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
  } catch {
    // Preferences are best-effort; the session still works without them.
  }
}

export function resetLayout() {
  try {
    localStorage.removeItem(LAYOUT_KEY);
  } catch {
    // Ignore — reset stays best-effort.
  }
  return DEFAULT_LAYOUT;
}

interface LayoutPrefsValue {
  prefs: LayoutPrefs;
  update: (patch: Partial<LayoutPrefs>) => void;
  reset: () => void;
}

const LayoutContext = createContext<LayoutPrefsValue>({
  prefs: DEFAULT_LAYOUT,
  update: () => {},
  reset: () => {},
});

/** One shared layout-preference state for app bar and workspaces. */
export function LayoutPrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<LayoutPrefs>(readLayout);

  const update = useCallback((patch: Partial<LayoutPrefs>) => {
    setPrefs((current) => {
      const next: LayoutPrefs = {
        ...current,
        ...patch,
        inspectorWidth: clamp(
          patch.inspectorWidth ?? current.inspectorWidth,
          LAYOUT_LIMITS.inspectorWidth,
        ),
        activityHeight: clamp(
          patch.activityHeight ?? current.activityHeight,
          LAYOUT_LIMITS.activityHeight,
        ),
      };
      writeLayout(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => setPrefs(resetLayout()), []);

  return (
    <LayoutContext.Provider value={{ prefs, update, reset }}>{children}</LayoutContext.Provider>
  );
}

export function useLayoutPrefs() {
  return useContext(LayoutContext);
}

/** Light/dark/auto — same `nemlab-theme` key the boot script reads. */
export function useThemePreference() {
  const [preference, setPreference] = useState<Theme>(() => {
    const applied = document.documentElement.dataset.theme;
    return applied === "dark" || applied === "light" ? applied : "auto";
  });

  useEffect(() => {
    if (preference === "auto") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = preference;
    }
    try {
      localStorage.setItem(THEME_KEY, preference);
    } catch {
      // Works for this visit without persistence.
    }
  }, [preference]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== THEME_KEY && event.key !== null) return;
      const next = event.newValue;
      setPreference(next === "light" || next === "dark" ? next : "auto");
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  return [preference, setPreference] as const;
}
