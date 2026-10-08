import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router";
import {
  REGIONS,
  apiGet,
  beginLoadOperation,
  dispatchLoadOperation,
  marketDay,
  pauseLoadOperation,
  plusDays,
  resumeLoadOperation,
  submitGridImport,
} from "../api";
import type {
  LoadDispatchOutcome,
  LoadOperation,
  LoadOperationDetail,
  Region,
  SessionView,
} from "../api";
import { StatusChip } from "../components/StatusChip";
import { Empty, Failure, Loading, Panel } from "../components/States";

const POLL_MS = 20_000;
const MAX_SCOPE_DAYS = 366;
const CHUNK_DAYS = 31;
const BASELINE_DAYS = 90;

export const LOAD_DRAFT_KEY = "admin.loadDraft";

export interface LoadDraft {
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

function writeLoadDraft(draft: LoadDraft) {
  sessionStorage.setItem(LOAD_DRAFT_KEY, JSON.stringify(draft));
}

function daysBetween(start: string, endExclusive: string): number {
  return Math.round(
    (Date.parse(`${endExclusive}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000,
  );
}

interface Scope {
  region: Region;
  start: string;
  endExclusive: string;
}

function scopeSummary(scope: Scope) {
  const days = daysBetween(scope.start, scope.endExclusive);
  return {
    days,
    chunks: Math.ceil(days / CHUNK_DAYS),
    lastDay: plusDays(scope.endExclusive, -1),
  };
}

/** Step 1–2 of the owner journey: pick a scope, review what the loader will
 * submit, then persist one resumable load operation. The draft survives a
 * reload via sessionStorage; the operation itself is authoritative. */
function ScopePanel({ session }: { session: SessionView }) {
  const client = useQueryClient();
  const initial = readLoadDraft();
  const [region, setRegion] = useState<Region>(initial?.region ?? "NSW1");
  const [start, setStart] = useState(initial?.start ?? plusDays(marketDay(), -31));
  const [end, setEnd] = useState(initial?.end ?? plusDays(marketDay(), -1));
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    writeLoadDraft({ region, start, end });
  }, [region, start, end]);

  function review() {
    setCreated(null);
    setFailure(null);
    if (!start || !end) {
      setError("Choose both a first and a last day.");
      return;
    }
    if (end < start) {
      setError("The last day must be on or after the first day.");
      return;
    }
    const last = plusDays(marketDay(), -1);
    if (end > last) {
      setError(`Only completed market days are loadable — the last day can be ${last} at most.`);
      return;
    }
    const days = daysBetween(start, plusDays(end, 1));
    if (days > MAX_SCOPE_DAYS) {
      setError(`Load at most ${MAX_SCOPE_DAYS} days per operation.`);
      return;
    }
    setError(null);
    setScope({ region, start, endExclusive: plusDays(end, 1) });
  }

  async function begin() {
    if (!scope) return;
    setBusy(true);
    setFailure(null);
    try {
      const op = await beginLoadOperation(session.csrfToken, {
        region: scope.region,
        startDay: scope.start,
        endExclusive: scope.endExclusive,
      });
      setCreated(op?.id ?? null);
      setScope(null);
      await client.invalidateQueries({ queryKey: ["load-operations"] });
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  const summary = scope ? scopeSummary(scope) : null;
  return (
    <Panel title="Load a window of data">
      <p className="hint">
        One operation loads grid observations first, then prices — the same pipeline as the manual
        runbook, chunked into bounded submissions the queues can deduplicate. It never publishes.
      </p>
      <div className="scenario-form">
        <div className="scenario-fields">
          <label htmlFor="load-region">Region</label>
          <select
            id="load-region"
            value={region}
            onChange={(e) => {
              setRegion(e.target.value as Region);
              setScope(null);
            }}
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <label htmlFor="load-start">First day</label>
          <input
            id="load-start"
            type="date"
            value={start}
            max={plusDays(marketDay(), -1)}
            onChange={(e) => {
              setStart(e.target.value);
              setScope(null);
            }}
          />
          <label htmlFor="load-end">Last day</label>
          <input
            id="load-end"
            type="date"
            value={end}
            max={plusDays(marketDay(), -1)}
            onChange={(e) => {
              setEnd(e.target.value);
              setScope(null);
            }}
          />
          {error && (
            <p className="hint" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="primary" onClick={review} disabled={busy}>
            Review scope
          </button>
        </div>
      </div>
      {scope && summary && (
        <section className="card" aria-label="Scope review">
          <h3>
            {scope.region}, {scope.start} to {summary.lastDay}
          </h3>
          <ul>
            <li>
              {summary.days} market {summary.days === 1 ? "day" : "days"} across {summary.chunks}{" "}
              bounded {summary.chunks === 1 ? "chunk" : "chunks"} of at most {CHUNK_DAYS} days each.
            </li>
            <li>
              Grid phase first: {summary.chunks} import{" "}
              {summary.chunks === 1 ? "submission" : "submissions"}, each fanning out to one job per
              day. Then the price phase refreshes all {summary.days} days.
            </li>
            <li>
              Already-stored days deduplicate safely — overlap never corrupts revisions, and reloads
              or tab closure cannot lose or double submissions.
            </li>
          </ul>
          <p className="hint">
            Dispatch is explicit: you step the operation forward chunk by chunk below, and it stays
            resumable between visits.
          </p>
          <button type="button" className="primary" onClick={() => void begin()} disabled={busy}>
            {busy ? "Creating…" : "Start loading"}
          </button>
        </section>
      )}
      {created && (
        <p className="hint" role="status">
          Load operation created — dispatch its first chunk below.
        </p>
      )}
      {failure !== null && <Failure error={failure} />}
    </Panel>
  );
}

function DispatchNote({ outcome }: { outcome: LoadDispatchOutcome }) {
  if (outcome.outcome === "backpressured") {
    return (
      <p className="hint" role="alert">
        Queues are full — this dispatch was held back and nothing moved. Try again once running jobs
        drain; resubmitting is safe.
      </p>
    );
  }
  if (outcome.outcome === "dispatched") {
    return (
      <p className="hint" role="status">
        All chunks are submitted — jobs now run independently in the queues.
      </p>
    );
  }
  const child = outcome.child;
  return (
    <p className="hint" role="status">
      Submitted {child?.phase} chunk {child?.startDay} – {child?.endExclusive}.
    </p>
  );
}

function OperationCard({ operation, session }: { operation: LoadOperation; session: SessionView }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<LoadDispatchOutcome | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const owner = session.role === "owner";
  const detail = useQuery({
    queryKey: ["load-operation", operation.id],
    enabled: open,
    queryFn: ({ signal }) =>
      apiGet<LoadOperationDetail>(`/api/admin/v1/load-operations/${operation.id}`, signal),
    refetchInterval: POLL_MS,
  });

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setFailure(null);
    try {
      setOutcome((await action()) as LoadDispatchOutcome | null);
      await client.invalidateQueries({ queryKey: ["load-operations"] });
      await detail.refetch();
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  const coverageHref = `/?view=coverage&region=${operation.region}&from=${operation.startDay}&to=${plusDays(
    operation.endExclusive,
    -1,
  )}`;
  return (
    <li className="job-row">
      <div className="job-summary">
        <button
          type="button"
          className="linklike"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {operation.region} {operation.startDay} – {plusDays(operation.endExclusive, -1)}
        </button>
        <StatusChip status={operation.status} />
        <span className="hint">
          phase {operation.phase} · next {operation.nextDay} · {operation.actor}
        </span>
      </div>
      {owner && (
        <div className="job-actions">
          {operation.status === "dispatching" && (
            <>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() =>
                  void act(() => dispatchLoadOperation(session.csrfToken, operation.id))
                }
              >
                Dispatch next chunk
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => void act(() => pauseLoadOperation(session.csrfToken, operation.id))}
              >
                Pause dispatch
              </button>
            </>
          )}
          {operation.status === "paused" && (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void act(() => resumeLoadOperation(session.csrfToken, operation.id))}
            >
              Resume dispatch
            </button>
          )}
        </div>
      )}
      {outcome && <DispatchNote outcome={outcome} />}
      {failure !== null && <Failure error={failure} />}
      {operation.status === "dispatched" && (
        <p className="hint">
          All bounded submissions are in the queues — jobs continue on their own.{" "}
          <Link to={coverageHref}>Recheck coverage</Link> once they finish; optional fuel failures
          stay listed on the Jobs page.
        </p>
      )}
      {operation.status === "paused" && (
        <p className="hint">
          Paused — queued jobs keep running; resume submits the remaining chunks. Reloads and tab
          closure never duplicate requests: child keys rebind through queue idempotency.
        </p>
      )}
      {open && (
        <div className="job-detail">
          {detail.isPending ? (
            <Loading label="Reading operation…" />
          ) : detail.isError ? (
            <Failure error={detail.error} />
          ) : detail.data.children.length === 0 ? (
            <Empty label="No chunks submitted yet." />
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Phase</th>
                    <th scope="col">Days</th>
                    <th scope="col">Request key</th>
                    <th scope="col">Jobs</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.children.map((child) => (
                    <tr key={child.requestKey}>
                      <td>{child.phase}</td>
                      <td>
                        {child.startDay} – {child.endExclusive}
                      </td>
                      <td>
                        <code>{child.requestKey}</code>
                      </td>
                      <td>
                        {child.jobs.map((job) => (
                          <span key={job.id} className="job-ref" title={job.diagnostic ?? ""}>
                            <StatusChip status={job.status} />
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function OperationsPanel({ session }: { session: SessionView }) {
  const operations = useQuery({
    queryKey: ["load-operations"],
    queryFn: ({ signal }) => apiGet<LoadOperation[]>("/api/admin/v1/load-operations", signal),
    refetchInterval: POLL_MS,
  });
  return (
    <Panel title="Load operations">
      {operations.isPending ? (
        <Loading />
      ) : operations.isError ? (
        <Failure error={operations.error} />
      ) : operations.data.length === 0 ? (
        <Empty label="No load operations yet." />
      ) : (
        <ul className="job-list">
          {operations.data.map((op) => (
            <OperationCard key={op.id} operation={op} session={session} />
          ))}
        </ul>
      )}
      <p className="hint">
        Pausing stops new submissions — it never cancels queued work. An operation never publishes;
        detection is a separate explicit step on the Publications page.
      </p>
    </Panel>
  );
}

/** Step 4 companion: prior demand history for ramp baselines is an explicit,
 * separate import — never silently fetched by the detector flow. Baseline
 * needs only demand, so it submits grid-import jobs directly (no price
 * phase) with deterministic keys that deduplicate on resubmit. */
function BaselinePanel({ session }: { session: SessionView }) {
  const client = useQueryClient();
  const [start, setStart] = useState(() => {
    const draft = readLoadDraft();
    return plusDays(draft?.start ?? marketDay(), -BASELINE_DAYS);
  });
  const [end, setEnd] = useState(() => {
    const draft = readLoadDraft();
    return plusDays(draft?.start ?? marketDay(), -1);
  });
  const [region, setRegion] = useState<Region>(() => readLoadDraft()?.region ?? "NSW1");
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
        await submitGridImport(session.csrfToken, `baseline:${region}:${chunkStart}`, {
          region,
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
    <Panel title="Baseline demand history (optional)">
      <p className="hint">
        Unusual-ramp detection needs {BASELINE_DAYS} days of prior demand per candidate day. This is
        an explicit extra import with its own window — coverage checks never fetch it silently. It
        loads grid observations only; prices are not needed for baselines.
      </p>
      <div className="scenario-form">
        <div className="scenario-fields">
          <label htmlFor="base-region">Region</label>
          <select
            id="base-region"
            value={region}
            onChange={(e) => setRegion(e.target.value as Region)}
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <label htmlFor="base-start">First day</label>
          <input
            id="base-start"
            type="date"
            value={start}
            max={plusDays(marketDay(), -1)}
            onChange={(e) => setStart(e.target.value)}
          />
          <label htmlFor="base-end">Last day</label>
          <input
            id="base-end"
            type="date"
            value={end}
            max={plusDays(marketDay(), -1)}
            onChange={(e) => setEnd(e.target.value)}
          />
          {error && (
            <p className="hint" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "Submitting…" : "Import baseline history"}
          </button>
        </div>
      </div>
      {report && (
        <p className="hint" role="status">
          {report}
        </p>
      )}
      {failure !== null && <Failure error={failure} />}
    </Panel>
  );
}

export function LoadPage() {
  const session = useOutletContext<SessionView>();
  const owner = session.role === "owner";
  return (
    <>
      <p className="eyebrow">Load data</p>
      <h1 tabIndex={-1}>Bring missing days into storage</h1>
      <p className="intro">
        Guided loading for one region: review the scope, start a resumable operation, then step
        through bounded chunks. Publishing stays a separate decision.
      </p>
      {owner ? (
        <ScopePanel session={session} />
      ) : (
        <Panel title="Load a window of data">
          <p className="hint">
            Loading data is an owner action — your read-only access covers what is stored, queued
            and published, but starting imports is reserved to the owner.
          </p>
        </Panel>
      )}
      <OperationsPanel session={session} />
      {owner && <BaselinePanel session={session} />}
    </>
  );
}
