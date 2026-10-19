import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  apiGet,
  cancelGridImport,
  dispatchLoadOperation,
  pauseLoadOperation,
  resumeLoadOperation,
  plusDays,
} from "../api";
import { fmtDateTime } from "../format";
import type {
  Event,
  GridImport,
  Job,
  LoadDispatchOutcome,
  LoadOperation,
  LoadOperationDetail,
  Region,
  SessionView,
} from "../api";
import { DataTable } from "../components/Table";
import type { Column } from "../components/Table";
import { StatusChip } from "../components/StatusChip";
import { Empty, Failure, Loading } from "../components/States";
import type { Scope, Selection } from "./scope";

export const POLL_MS = 20_000;

export const jobsQueries = {
  operations: {
    queryKey: ["load-operations"],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      apiGet<LoadOperation[]>("/api/admin/v1/load-operations", signal),
    refetchInterval: POLL_MS,
  },
  imports: {
    queryKey: ["grid-imports"],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      apiGet<GridImport[]>("/api/admin/v1/grid-imports", signal),
    refetchInterval: POLL_MS,
  },
  refreshes: {
    queryKey: ["price-refreshes"],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      apiGet<Job[]>("/api/admin/v1/price-refreshes", signal),
    refetchInterval: POLL_MS,
  },
};

/** One row per unit of work — the three bounded lists stay separate
 * server-side; the type column and filter keep that honest. */
export type JobRow =
  | { kind: "op"; id: string; op: LoadOperation }
  | { kind: "import"; id: string; job: GridImport }
  | { kind: "refresh"; id: string; job: Job };

const TYPE_LABEL: Record<JobRow["kind"], string> = {
  op: "Load operation",
  import: "Grid import",
  refresh: "Price refresh",
};

const KIND_HINT: Record<JobTypeFilter, string> = {
  all: "Every queued, running and finished job across all queues.",
  op: "Multi-day load operations — owner-started jobs that fetch and store data.",
  import: "Single-day grid data imports dispatched by the worker.",
  refresh: "Price re-fetch jobs that update stored market prices.",
};

function rowStatus(row: JobRow): string {
  return row.kind === "op" ? row.op.status : row.job.status;
}
function rowRegion(row: JobRow): string {
  return row.kind === "op" ? row.op.region : row.job.region;
}
function rowWindow(row: JobRow): string {
  if (row.kind === "refresh") return row.job.day;
  const r = row.kind === "op" ? row.op : row.job;
  return `${r.startDay} – ${plusDays(r.endExclusive, -1)}`;
}
function rowWhen(row: JobRow): string | null {
  if (row.kind === "op") return row.op.updatedAt;
  if (row.kind === "import") return row.job.availableAt;
  return row.job.availableAt;
}
function rowProgress(row: JobRow): string {
  if (row.kind === "op") return `phase ${row.op.phase} · next ${row.op.nextDay}`;
  if (row.kind === "import") return `next ${row.job.nextDay}`;
  return "—";
}
function rowAttempts(row: JobRow): number | string {
  return row.kind === "op" ? "—" : row.job.attempts;
}
function rowDiagnostic(row: JobRow): string | null | undefined {
  return row.kind === "op" ? null : row.job.diagnostic;
}

const COLUMNS: Column<JobRow>[] = [
  { id: "status", header: "Status", render: (r) => <StatusChip status={rowStatus(r)} /> },
  { id: "type", header: "Type", render: (r) => TYPE_LABEL[r.kind] },
  { id: "region", header: "Region", render: rowRegion },
  { id: "window", header: "Window / day", render: rowWindow },
  { id: "progress", header: "Progress", render: rowProgress },
  { id: "attempts", header: "Attempts", align: "right", render: rowAttempts },
  {
    id: "when",
    header: "Updated",
    render: (r) => {
      const when = rowWhen(r);
      return when ? fmtDateTime(when) : "—";
    },
  },
  { id: "note", header: "Note", render: (r) => rowDiagnostic(r) ?? "—" },
];

export type JobTypeFilter = "all" | JobRow["kind"];

export function JobsView({
  rows,
  filter,
  onFilter,
  selected,
  onSelect,
  pending,
  error,
}: {
  rows: JobRow[];
  filter: JobTypeFilter;
  onFilter: (filter: JobTypeFilter) => void;
  selected: Selection | null;
  onSelect: (sel: Selection) => void;
  pending: boolean;
  error: unknown;
}) {
  if (pending) return <Loading label="Reading work queues…" />;
  if (error) return <Failure error={error} />;
  const filtered = filter === "all" ? rows : rows.filter((r) => r.kind === filter);
  const sorted = [...filtered].sort((a, b) => (rowWhen(b) ?? "").localeCompare(rowWhen(a) ?? ""));
  return (
    <>
      <div className="tabs">
        {(["all", "op", "import", "refresh"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className={`tab${filter === kind ? " active" : ""}`}
            title={KIND_HINT[kind]}
            onClick={() => onFilter(kind)}
          >
            {kind === "all" ? "All work" : `${TYPE_LABEL[kind]}s`}
          </button>
        ))}
      </div>
      <DataTable
        columns={COLUMNS}
        rows={sorted}
        rowKey={(r) => `${r.kind}:${r.id}`}
        selectedKey={selected ? `${selected.kind}:${selected.id}` : null}
        onSelect={(key) => {
          const [kind, id] = key.split(":", 2) as [JobRow["kind"], string];
          onSelect({ kind, id });
        }}
        empty={
          <p className="empty-insp">
            No {filter === "all" ? "work" : `${TYPE_LABEL[filter as JobRow["kind"]]}s`} in the
            loaded lists.
          </p>
        }
      />
      <p className="hint table-note">
        Recent bounded lists from each queue — the type filter sorts and filters within loaded
        results, not the full history.
      </p>
    </>
  );
}

function Events({ path }: { path: string }) {
  const events = useQuery({
    queryKey: ["job-events", path],
    queryFn: ({ signal }) => apiGet<Event[]>(path, signal),
  });
  if (events.isPending) return <Loading label="Reading job audit…" />;
  if (events.isError) return <Failure error={events.error} />;
  if (events.data.length === 0) return <Empty label="No audit events yet." />;
  return (
    <ol className="event-list">
      {events.data.map((event) => (
        <li key={event.id}>
          <time dateTime={event.occurredAt}>{fmtDateTime(event.occurredAt)}</time>{" "}
          <strong>{event.action.replaceAll("_", " ")}</strong> — {event.actor}
          {event.diagnostic && <span className="hint"> ({event.diagnostic})</span>}
        </li>
      ))}
    </ol>
  );
}

function DispatchNote({ outcome }: { outcome: LoadDispatchOutcome }) {
  if (outcome.outcome === "backpressured") {
    return (
      <p className="banner warn" role="alert">
        Queues are full — this dispatch was held back and nothing moved. Try again once running jobs
        drain; resubmitting is safe.
      </p>
    );
  }
  if (outcome.outcome === "dispatched") {
    return (
      <p className="banner" role="status">
        All chunks are submitted — jobs now run independently in the queues.
      </p>
    );
  }
  const child = outcome.child;
  return (
    <p className="banner" role="status">
      Submitted {child?.phase} chunk {child?.startDay} – {child?.endExclusive}.
    </p>
  );
}

export function OperationInspector({
  operation,
  session,
}: {
  operation: LoadOperation;
  session: SessionView;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<LoadDispatchOutcome | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const owner = session.role === "owner";
  const detail = useQuery({
    queryKey: ["load-operation", operation.id],
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

  return (
    <>
      <div className="insp-head">
        <h2>
          {operation.region} {operation.startDay} – {plusDays(operation.endExclusive, -1)}
        </h2>
        <div className="sub">
          Load operation · <StatusChip status={operation.status} /> · {operation.actor}
        </div>
      </div>
      <div className="insp-sec">
        <h3>State</h3>
        <dl className="kv">
          <dt>Phase</dt>
          <dd>{operation.phase}</dd>
          <dt>Next day</dt>
          <dd>{operation.nextDay}</dd>
          <dt>Updated</dt>
          <dd>{fmtDateTime(operation.updatedAt)}</dd>
        </dl>
        {operation.status === "dispatched" && (
          <p className="hint">
            All bounded submissions are in the queues — jobs continue on their own.
          </p>
        )}
        {operation.status === "paused" && (
          <p className="hint">
            Paused — queued jobs keep running; resume submits the remaining chunks.
          </p>
        )}
      </div>
      <div className="insp-sec">
        <h3>Chunks</h3>
        {detail.isPending ? (
          <Loading label="Reading operation…" />
        ) : detail.isError ? (
          <Failure error={detail.error} />
        ) : detail.data.children.length === 0 ? (
          <p className="hint">No chunks submitted yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Phase</th>
                <th scope="col">Days</th>
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
        )}
      </div>
      {owner && (operation.status === "dispatching" || operation.status === "paused") && (
        <div className="insp-actions">
          {operation.status === "dispatching" && (
            <>
              <button
                type="button"
                className="btn primary"
                title="Queue the next batch of days in this load operation."
                disabled={busy}
                onClick={() =>
                  void act(() => dispatchLoadOperation(session.csrfToken, operation.id))
                }
              >
                Dispatch next chunk
              </button>
              <button
                type="button"
                className="btn"
                title="Pause this operation — queued work finishes but nothing new is dispatched."
                disabled={busy}
                onClick={() => void act(() => pauseLoadOperation(session.csrfToken, operation.id))}
              >
                Stop further dispatch
              </button>
            </>
          )}
          {operation.status === "paused" && (
            <button
              type="button"
              className="btn primary"
              title="Continue dispatching the remaining days of this paused operation."
              disabled={busy}
              onClick={() => void act(() => resumeLoadOperation(session.csrfToken, operation.id))}
            >
              Resume dispatch
            </button>
          )}
        </div>
      )}
      {outcome && (
        <div className="insp-sec">
          <DispatchNote outcome={outcome} />
        </div>
      )}
      {failure !== null && (
        <div className="insp-sec">
          <Failure error={failure} />
        </div>
      )}
    </>
  );
}

const CANCELLABLE = new Set(["QUEUED", "RUNNING", "PAUSED"]);
const RESUBMITTABLE = new Set(["FAILED", "CANCELLED"]);

export function ImportInspector({
  job,
  session,
  onLoadDraft,
}: {
  job: GridImport;
  session: SessionView;
  onLoadDraft: (draft: { region: Region; start: string; end: string }) => void;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const owner = session.role === "owner";

  async function cancel() {
    setBusy(true);
    setFailure(null);
    try {
      await cancelGridImport(session.csrfToken, job.id);
      await client.invalidateQueries({ queryKey: ["grid-imports"] });
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  function submitAgain() {
    // Recovery is a new bounded submission over the remaining window — the
    // checkpoint (`nextDay`) marks where the old job stopped, never a retry
    // in place.
    onLoadDraft({
      region: job.region,
      start: job.nextDay < job.endExclusive ? job.nextDay : job.startDay,
      end: plusDays(job.endExclusive, -1),
    });
  }

  return (
    <>
      <div className="insp-head">
        <h2>
          {job.region} {job.startDay} – {plusDays(job.endExclusive, -1)}
        </h2>
        <div className="sub">
          Grid import · <StatusChip status={job.status} />
        </div>
      </div>
      <div className="insp-sec">
        <h3>Job</h3>
        <dl className="kv">
          <dt>Checkpoint</dt>
          <dd>{job.nextDay}</dd>
          <dt>Attempts</dt>
          <dd>{job.attempts}</dd>
          <dt>Optional failures</dt>
          <dd>{job.optionalFailures}</dd>
          {job.diagnostic && (
            <>
              <dt>Note</dt>
              <dd>{job.diagnostic}</dd>
            </>
          )}
          {job.availableAt && (
            <>
              <dt>Available</dt>
              <dd>{fmtDateTime(job.availableAt)}</dd>
            </>
          )}
        </dl>
      </div>
      {owner && (CANCELLABLE.has(job.status) || RESUBMITTABLE.has(job.status)) && (
        <div className="insp-actions">
          {CANCELLABLE.has(job.status) && (
            <button
              type="button"
              className="btn"
              title="Cancel this queued or running job — already-imported days are kept."
              disabled={busy}
              onClick={() => void cancel()}
            >
              Cancel job
            </button>
          )}
          {RESUBMITTABLE.has(job.status) && (
            <button
              type="button"
              className="btn"
              title="Open the load drawer with this job's unfinished window pre-filled."
              onClick={submitAgain}
            >
              Submit remaining data
            </button>
          )}
        </div>
      )}
      {failure !== null && (
        <div className="insp-sec">
          <Failure error={failure} />
        </div>
      )}
      <div className="insp-sec">
        <h3>Audit</h3>
        <Events path={`/api/admin/v1/grid-imports/${job.id}/events`} />
      </div>
    </>
  );
}

export function RefreshInspector({ job }: { job: Job }) {
  return (
    <>
      <div className="insp-head">
        <h2>
          {job.region} {job.day}
        </h2>
        <div className="sub">
          Price refresh · <StatusChip status={job.status} />
        </div>
      </div>
      <div className="insp-sec">
        <h3>Job</h3>
        <dl className="kv">
          <dt>Attempts</dt>
          <dd>{job.attempts}</dd>
          {job.diagnostic && (
            <>
              <dt>Note</dt>
              <dd>{job.diagnostic}</dd>
            </>
          )}
          {job.availableAt && (
            <>
              <dt>Available</dt>
              <dd>{fmtDateTime(job.availableAt)}</dd>
            </>
          )}
        </dl>
      </div>
      <div className="insp-sec">
        <h3>Audit</h3>
        <Events path={`/api/admin/v1/price-refreshes/${job.id}/events`} />
      </div>
    </>
  );
}

/** Lower pane rows — context-filtered work matching the applied scope,
 * with an explicit "All recent" escape. Region match plus window overlap. */
export function ActivityBody({
  rows,
  scope,
  allRecent,
  onSelect,
}: {
  rows: JobRow[];
  scope: Scope;
  allRecent: boolean;
  onSelect: (sel: Selection) => void;
}) {
  const scoped = allRecent
    ? rows
    : rows.filter((r) => {
        if (rowRegion(r) !== scope.region) return false;
        if (r.kind === "refresh") return r.job.day >= scope.start && r.job.day <= scope.end;
        const window = r.kind === "op" ? r.op : r.job;
        return window.startDay <= scope.end && window.endExclusive > scope.start;
      });
  const sorted = [...scoped].sort((a, b) => (rowWhen(b) ?? "").localeCompare(rowWhen(a) ?? ""));
  if (sorted.length === 0) {
    return (
      <p className="empty-insp">
        {allRecent
          ? "No recent work."
          : `No loaded work overlaps ${scope.region} · ${scope.start} – ${scope.end}.`}
      </p>
    );
  }
  return (
    <table className="grid">
      <thead>
        <tr>
          <th>Status</th>
          <th>Type</th>
          <th>Region</th>
          <th>Window / day</th>
          <th>Progress</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr
            key={`${row.kind}:${row.id}`}
            onClick={() => onSelect({ kind: row.kind, id: row.id })}
          >
            <td>
              <StatusChip status={rowStatus(row)} />
            </td>
            <td>{TYPE_LABEL[row.kind]}</td>
            <td>{rowRegion(row)}</td>
            <td>{rowWindow(row)}</td>
            <td>{rowProgress(row)}</td>
            <td>{rowWhen(row) ? fmtDateTime(rowWhen(row)!) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
