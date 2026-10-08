import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { REGIONS, apiGet, beginLoadOperation, marketDay, plusDays, submitGridImport } from "../api";
import type { GridCoverage, Region, SessionView } from "../api";
import { Drawer } from "../components/Drawer";
import { Failure } from "../components/States";
import type { Scope } from "./scope";

export const LOAD_DRAFT_KEY = "admin.loadDraft";

const MAX_SCOPE_DAYS = 366;
const CHUNK_DAYS = 31;
const BASELINE_DAYS = 90;

interface LoadDraft {
  region: Region;
  start: string;
  end: string;
}

export function readLoadDraft(): LoadDraft | null {
  try {
    const raw = sessionStorage.getItem(LOAD_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as LoadDraft;
    if (
      REGIONS.includes(draft.region) &&
      /^\d{4}-\d{2}-\d{2}$/.test(draft.start) &&
      /^\d{4}-\d{2}-\d{2}$/.test(draft.end)
    ) {
      return draft;
    }
  } catch {
    /* unreadable draft — fall back to defaults */
  }
  return null;
}

function writeLoadDraft(draft: Scope) {
  sessionStorage.setItem(LOAD_DRAFT_KEY, JSON.stringify(draft));
}

function daysBetween(start: string, endExclusive: string): number {
  return Math.round(
    (Date.parse(`${endExclusive}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000,
  );
}

/**
 * Owner load workflow as a workspace drawer. The form captures the applied
 * scope on first open; edits persist to sessionStorage so a dirty draft
 * survives close and reload. Nothing dispatches without an explicit click —
 * closing and reopening never submits twice. The created operation is
 * resumable from the Loads & Jobs inspector.
 */
export function LoadDrawer({
  scope,
  session,
  open,
  onClose,
  onStarted,
}: {
  scope: Scope;
  session: SessionView;
  open: boolean;
  onClose: () => void;
  onStarted: () => void;
}) {
  const client = useQueryClient();
  const [form, setForm] = useState<Scope>(() => readLoadDraft() ?? scope);
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<GridCoverage | null>(null);

  // Reopening seeds from the persisted draft, else the applied scope.
  useEffect(() => {
    if (open) setForm(readLoadDraft() ?? scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scope captured at open
  }, [open]);

  useEffect(() => {
    if (open) writeLoadDraft(form);
  }, [open, form]);

  function edit(patch: Partial<Scope>) {
    setForm({ ...form, ...patch });
    setReviewed(false);
    setCoverage(null);
  }

  async function review() {
    setCreated(null);
    setFailure(null);
    setCoverage(null);
    if (!form.start || !form.end) {
      setError("Choose both a first and a last day.");
      return;
    }
    if (form.end < form.start) {
      setError("The last day must be on or after the first day.");
      return;
    }
    const last = plusDays(marketDay(), -1);
    if (form.end > last) {
      setError(`Only completed market days are loadable — the last day can be ${last} at most.`);
      return;
    }
    if (daysBetween(form.start, plusDays(form.end, 1)) > MAX_SCOPE_DAYS) {
      setError(`Load at most ${MAX_SCOPE_DAYS} days per operation.`);
      return;
    }
    setError(null);
    setReviewed(true);
    // What is already stored — the review shows it honestly, not as a blocker.
    try {
      setCoverage(
        await apiGet<GridCoverage>(
          `/api/admin/v1/grid-coverage/${form.region}?start=${form.start}&endExclusive=${plusDays(form.end, 1)}`,
        ),
      );
    } catch {
      setCoverage(null);
    }
  }

  async function begin() {
    setBusy(true);
    setFailure(null);
    try {
      const op = await beginLoadOperation(session.csrfToken, {
        region: form.region,
        startDay: form.start,
        endExclusive: plusDays(form.end, 1),
      });
      setCreated(op?.id ?? null);
      setReviewed(false);
      await client.invalidateQueries({ queryKey: ["load-operations"] });
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  const days = daysBetween(form.start, plusDays(form.end, 1));
  const chunks = Math.ceil(days / CHUNK_DAYS);
  const alreadyStored = coverage?.days.filter((d) => d.availability === "COMPLETE").length;
  return (
    <Drawer title="Load data" open={open} onClose={onClose}>
      <p className="hint">
        One operation loads grid observations first, then prices — chunked into bounded submissions
        the queues can deduplicate. It never publishes.
      </p>
      <div className="field-row">
        <label htmlFor="ld-region">Region</label>
        <select
          id="ld-region"
          value={form.region}
          onChange={(e) => edit({ region: e.target.value as Region })}
        >
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <label htmlFor="ld-start">First day</label>
        <input
          id="ld-start"
          type="date"
          value={form.start}
          max={plusDays(marketDay(), -1)}
          onChange={(e) => edit({ start: e.target.value })}
        />
      </div>
      <div className="field-row">
        <label htmlFor="ld-end">Last day</label>
        <input
          id="ld-end"
          type="date"
          value={form.end}
          max={plusDays(marketDay(), -1)}
          onChange={(e) => edit({ end: e.target.value })}
        />
      </div>
      {error && (
        <p className="hint" role="alert">
          {error}
        </p>
      )}
      <div className="job-actions">
        <button type="button" className="btn primary" onClick={() => void review()} disabled={busy}>
          Review scope
        </button>
        <button type="button" className="btn ghost" onClick={() => setForm(scope)} disabled={busy}>
          Use applied scope
        </button>
      </div>
      {reviewed && (
        <section aria-label="Scope review">
          <h3>
            {form.region}, {form.start} to {form.end}
          </h3>
          <ul className="hint">
            <li>
              {days} market {days === 1 ? "day" : "days"} across {chunks} bounded{" "}
              {chunks === 1 ? "chunk" : "chunks"} of at most {CHUNK_DAYS} days each.
            </li>
            <li>
              Grid phase first — one job per day — then the price phase refreshes all {days} days.
            </li>
            {alreadyStored !== undefined && (
              <li>
                {alreadyStored} of {days} days already report complete stored data — overlap
                deduplicates safely.
              </li>
            )}
            <li>
              Dispatch is explicit: step the operation forward from Loads &amp; Jobs; it stays
              resumable between visits.
            </li>
          </ul>
          <button
            type="button"
            className="btn primary"
            onClick={() => void begin()}
            disabled={busy}
          >
            {busy ? "Creating…" : "Start loading"}
          </button>
        </section>
      )}
      {created && (
        <p role="status">
          Load operation created — dispatch its chunks from Loads &amp; Jobs.{" "}
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              onStarted();
              onClose();
            }}
          >
            Open Loads &amp; Jobs
          </button>
        </p>
      )}
      {failure !== null && <Failure error={failure} />}
      <BaselineSection scope={form} session={session} />
    </Drawer>
  );
}

/** Prior demand history for ramp baselines — an explicit separate import,
 * never silently fetched. Prefills to the 90 days before the load start. */
function BaselineSection({ scope, session }: { scope: Scope; session: SessionView }) {
  const client = useQueryClient();
  const [start, setStart] = useState(() => plusDays(scope.start, -BASELINE_DAYS));
  const [end, setEnd] = useState(() => plusDays(scope.start, -1));
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setReport(null);
    setFailure(null);
    if (!start || !end || end < start) {
      setError("Choose a valid baseline window — the last day must follow the first.");
      return;
    }
    if (end > plusDays(marketDay(), -1)) {
      setError(
        `Only completed market days are loadable — the last day can be ${plusDays(marketDay(), -1)} at most.`,
      );
      return;
    }
    setBusy(true);
    const chunks: string[] = [];
    for (let day = start; day <= end; day = plusDays(day, CHUNK_DAYS)) {
      chunks.push(day);
    }
    let submitted = 0;
    try {
      for (const chunkStart of chunks) {
        const chunkEnd =
          plusDays(chunkStart, CHUNK_DAYS) <= plusDays(end, 1)
            ? plusDays(chunkStart, CHUNK_DAYS)
            : plusDays(end, 1);
        await submitGridImport(session.csrfToken, `baseline:${scope.region}:${chunkStart}`, {
          region: scope.region,
          startDay: chunkStart,
          endExclusive: chunkEnd,
        });
        submitted += 1;
      }
      setReport(
        `${submitted} baseline ${submitted === 1 ? "submission" : "submissions"} queued — days already loaded deduplicate safely.`,
      );
      await client.invalidateQueries({ queryKey: ["grid-imports"] });
    } catch (error) {
      setFailure(error);
      if (submitted > 0) {
        setReport(
          `${submitted} of ${chunks.length} submissions landed before the failure — resubmitting is safe, accepted chunks deduplicate.`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <details>
      <summary>Baseline demand history (optional)</summary>
      <p className="hint">
        Unusual-ramp detection needs {BASELINE_DAYS} days of prior demand per candidate day. This
        loads grid observations only — prices are not needed for baselines.
      </p>
      <div className="field-row">
        <label htmlFor="ld-base-start">First day</label>
        <input
          id="ld-base-start"
          type="date"
          value={start}
          max={plusDays(marketDay(), -1)}
          onChange={(e) => setStart(e.target.value)}
        />
      </div>
      <div className="field-row">
        <label htmlFor="ld-base-end">Last day</label>
        <input
          id="ld-base-end"
          type="date"
          value={end}
          max={plusDays(marketDay(), -1)}
          onChange={(e) => setEnd(e.target.value)}
        />
      </div>
      {error && (
        <p className="hint" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn" disabled={busy} onClick={() => void submit()}>
        {busy ? "Submitting…" : `Import baseline history for ${scope.region}`}
      </button>
      {report && (
        <p className="hint" role="status">
          {report}
        </p>
      )}
      {failure !== null && <Failure error={failure} />}
    </details>
  );
}
