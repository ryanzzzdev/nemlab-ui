import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet } from "../api";
import type { Event, GridImport, Job, LoadOperation, LoadOperationDetail } from "../api";
import { StatusChip } from "../components/StatusChip";
import { Empty, Failure, Loading, Panel } from "../components/States";

const POLL_MS = 20_000;

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
          <time dateTime={event.occurredAt}>
            {new Date(event.occurredAt).toLocaleString("en-AU")}
          </time>{" "}
          <strong>{event.action.replaceAll("_", " ")}</strong> — {event.actor}
          {event.diagnostic && <span className="hint"> ({event.diagnostic})</span>}
        </li>
      ))}
    </ol>
  );
}

function OperationRow({ operation }: { operation: LoadOperation }) {
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: ["load-operation", operation.id],
    enabled: open,
    queryFn: ({ signal }) =>
      apiGet<LoadOperationDetail>(`/api/admin/v1/load-operations/${operation.id}`, signal),
    refetchInterval: POLL_MS,
  });
  return (
    <li className="job-row">
      <div className="job-summary">
        <button
          type="button"
          className="linklike"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {operation.region} {operation.startDay} –{" "}
          {new Date(Date.parse(`${operation.endExclusive}T00:00:00Z`) - 86400000)
            .toISOString()
            .slice(0, 10)}
        </button>
        <StatusChip status={operation.status} />
        <span className="hint">
          phase {operation.phase} · next {operation.nextDay} · {operation.actor}
        </span>
      </div>
      {open && (
        <div className="job-detail">
          {detail.isPending ? (
            <Loading label="Reading operation…" />
          ) : detail.isError ? (
            <Failure error={detail.error} />
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Chunk</th>
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
                          <span key={job.id} className="job-ref">
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

function GridImportRow({ job }: { job: GridImport }) {
  const [open, setOpen] = useState(false);
  return (
    <tr>
      <td>
        <button
          type="button"
          className="linklike"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {job.startDay} – {job.endExclusive}
        </button>
        {open && <Events path={`/api/admin/v1/grid-imports/${job.id}/events`} />}
      </td>
      <td>{job.region}</td>
      <td>
        <StatusChip status={job.status} />
      </td>
      <td className="num">{job.nextDay}</td>
      <td className="num">{job.attempts}</td>
      <td className="num">{job.optionalFailures}</td>
      <td>{job.diagnostic ?? "—"}</td>
    </tr>
  );
}

function RefreshRow({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  return (
    <tr>
      <td>
        <button
          type="button"
          className="linklike"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {job.day}
        </button>
        {open && <Events path={`/api/admin/v1/price-refreshes/${job.id}/events`} />}
      </td>
      <td>{job.region}</td>
      <td>
        <StatusChip status={job.status} />
      </td>
      <td className="num">{job.attempts}</td>
      <td>{job.availableAt ? new Date(job.availableAt).toLocaleString("en-AU") : "—"}</td>
      <td>{job.diagnostic ?? "—"}</td>
    </tr>
  );
}

export function JobsPage() {
  const operations = useQuery({
    queryKey: ["load-operations"],
    queryFn: ({ signal }) => apiGet<LoadOperation[]>("/api/admin/v1/load-operations", signal),
    refetchInterval: POLL_MS,
  });
  const imports = useQuery({
    queryKey: ["grid-imports"],
    queryFn: ({ signal }) => apiGet<GridImport[]>("/api/admin/v1/grid-imports", signal),
    refetchInterval: POLL_MS,
  });
  const refreshes = useQuery({
    queryKey: ["price-refreshes"],
    queryFn: ({ signal }) => apiGet<Job[]>("/api/admin/v1/price-refreshes", signal),
    refetchInterval: POLL_MS,
  });

  return (
    <>
      <p className="eyebrow">Jobs</p>
      <h1 tabIndex={-1}>What work is running?</h1>
      <p className="intro">
        Queued, running and finished data work — refreshed every {POLL_MS / 1000} seconds while this
        page is open.
      </p>
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
              <OperationRow key={op.id} operation={op} />
            ))}
          </ul>
        )}
        <p className="hint">
          Queued chunks keep running if you close this tab — pausing an operation stops new
          submissions, it never cancels queued work.
        </p>
      </Panel>
      <Panel title="Grid imports">
        {imports.isPending ? (
          <Loading />
        ) : imports.isError ? (
          <Failure error={imports.error} />
        ) : imports.data.length === 0 ? (
          <Empty label="No grid imports yet." />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Window</th>
                  <th scope="col">Region</th>
                  <th scope="col">Status</th>
                  <th scope="col">Checkpoint</th>
                  <th scope="col" className="num">
                    Attempts
                  </th>
                  <th scope="col" className="num">
                    Optional failures
                  </th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {imports.data.map((job) => (
                  <GridImportRow key={job.id} job={job} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Price refreshes">
        {refreshes.isPending ? (
          <Loading />
        ) : refreshes.isError ? (
          <Failure error={refreshes.error} />
        ) : refreshes.data.length === 0 ? (
          <Empty label="No price refreshes yet." />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Region</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Attempts
                  </th>
                  <th scope="col">Available at</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {refreshes.data.map((job) => (
                  <RefreshRow key={job.id} job={job} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
