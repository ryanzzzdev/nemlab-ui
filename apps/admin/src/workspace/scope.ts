import { marketDay, plusDays } from "../api";
import type { Region } from "../api";

/** Shared workspace scope — draft edits apply deliberately, and the
 * applied scope lives in the URL so Back/Forward restores it. */

export const MAX_SCOPE_DAYS = 31;

export interface Scope {
  region: Region;
  /** Inclusive first day (YYYY-MM-DD). */
  start: string;
  /** Inclusive last day (YYYY-MM-DD). */
  end: string;
}

export function endExclusive(scope: Scope): string {
  return plusDays(scope.end, 1);
}

export function defaultScope(region: Region = "NSW1"): Scope {
  return { region, start: plusDays(marketDay(), -31), end: plusDays(marketDay(), -1) };
}

export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

export function validateScope(scope: Scope): string | null {
  if (!scope.start || !scope.end) return "Choose both a first and a last day.";
  if (scope.end < scope.start) return "The last day must be on or after the first day.";
  const last = plusDays(marketDay(), -1);
  if (scope.end > last) {
    return `Only completed market days are inspectable — the last day can be ${last} at most.`;
  }
  if (daysBetween(scope.start, scope.end) >= MAX_SCOPE_DAYS) {
    return `Inspect at most ${MAX_SCOPE_DAYS} days at once.`;
  }
  return null;
}

/** One active inspector selection at a time, encoded in the URL. */
export type Selection =
  | { kind: "day"; id: string }
  | { kind: "op" | "import" | "refresh" | "pub" | "attempt" | "simulation"; id: string };

export function parseSelection(raw: string | null): Selection | null {
  if (!raw) return null;
  const [kind, id] = raw.split(":", 2);
  if (
    id &&
    (kind === "day" ||
      kind === "op" ||
      kind === "import" ||
      kind === "refresh" ||
      kind === "pub" ||
      kind === "attempt" ||
      kind === "simulation")
  ) {
    return { kind, id } as Selection;
  }
  return null;
}

export function selectionParam(sel: Selection | null): string | null {
  return sel ? `${sel.kind}:${sel.id}` : null;
}
