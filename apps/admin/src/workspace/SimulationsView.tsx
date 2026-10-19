import { useQuery } from "@tanstack/react-query";
import type { InfiniteData, UseInfiniteQueryResult, UseQueryResult } from "@tanstack/react-query";
import { PUBLIC_BASE, getSimulation, listSimulations } from "../api";
import { fmtDateTime } from "../format";
import type {
  AdminSimulationDetail,
  AdminSimulationPage,
  AdminSimulationSummary,
  SimulationSort,
  SimulationStatus,
  SimulationStrategy,
} from "../api";
import { DataTable } from "../components/Table";
import type { Column } from "../components/Table";
import { StatusChip } from "../components/StatusChip";
import { Failure, Loading } from "../components/States";
import { POLL_MS } from "./JobsView";
import type { Scope } from "./scope";

export type SimStatusFilter = "all" | SimulationStatus;
export type SimStrategyFilter = "all" | SimulationStrategy;

export interface SimFilters {
  status: SimStatusFilter;
  strategy: SimStrategyFilter;
  sort: SimulationSort;
}

/** Scoped keyset-paged catalogue — `useInfiniteQuery` options; pages append
 * under a fixed scope fingerprint on the server. */
export function simulationsQuery(scope: Scope, filters: SimFilters) {
  const apiScope = { region: scope.region, startDay: scope.start, endDay: scope.end };
  const apiFilters = {
    status: filters.status === "all" ? undefined : filters.status,
    strategy: filters.strategy === "all" ? undefined : filters.strategy,
    sort: filters.sort,
  };
  return {
    queryKey: [
      "simulations",
      scope.region,
      scope.start,
      scope.end,
      apiFilters.status ?? "",
      apiFilters.strategy ?? "",
      filters.sort,
    ],
    queryFn: ({ signal, pageParam }: { signal: AbortSignal; pageParam: string | null }) =>
      listSimulations(
        apiScope,
        {
          ...(apiFilters.status ? { status: apiFilters.status } : {}),
          ...(apiFilters.strategy ? { strategy: apiFilters.strategy } : {}),
          sort: apiFilters.sort,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        signal,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page: AdminSimulationPage) => page.nextCursor ?? undefined,
  };
}

const STATUS_TABS: { id: SimStatusFilter; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "Every stored simulation in the applied scope." },
  { id: "QUEUED", label: "Queued", hint: "Waiting to be claimed by the worker." },
  { id: "RUNNING", label: "Running", hint: "A worker holds the lease on this simulation." },
  { id: "SUCCEEDED", label: "Succeeded", hint: "Finished with a stored result." },
  { id: "FAILED", label: "Failed", hint: "Exhausted its attempts without a result." },
];

const STRATEGY_LABEL: Record<string, string> = {
  fixed: "Fixed",
  threshold: "Threshold",
  hindsight: "Hindsight",
};

const COLUMNS: Column<AdminSimulationSummary>[] = [
  { id: "status", header: "Status", render: (r) => <StatusChip status={r.status} /> },
  { id: "day", header: "Day", render: (r) => r.day },
  { id: "created", header: "Created", render: (r) => fmtDateTime(r.createdAt) },
  {
    id: "capacity",
    header: "MWh",
    align: "right",
    render: (r) => r.capacityMWh,
  },
  {
    id: "power",
    header: "MW ch/dis",
    align: "right",
    render: (r) => `${r.chargeMW}/${r.dischargeMW}`,
  },
  {
    id: "strategies",
    header: "Strategies",
    render: (r) => r.strategies.map((s) => STRATEGY_LABEL[s] ?? s).join(" · "),
  },
  { id: "attempts", header: "Attempts", align: "right", render: (r) => r.attempts },
  { id: "note", header: "Note", render: (r) => r.diagnostic ?? "—" },
  {
    id: "result",
    header: "Result",
    render: (r) => (r.hasResult ? "Stored" : r.status === "SUCCEEDED" ? "Not stored" : "Pending"),
  },
  { id: "id", header: "ID", render: (r) => r.id.slice(0, 8) },
];

/** Stored-simulation catalogue for the applied scope — exact decimal strings
 * render verbatim; the summary never carries the full price/dispatch arrays. */
export function SimulationsView({
  query,
  filters,
  onFilter,
  scope,
  selectedId,
  onSelect,
}: {
  query: UseInfiniteQueryResult<InfiniteData<AdminSimulationPage>>;
  filters: SimFilters;
  onFilter: (patch: Partial<SimFilters>) => void;
  scope: Scope;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (query.isPending) return <Loading label="Reading stored simulations…" />;
  if (query.isError) return <Failure error={query.error} />;
  const pages = query.data.pages;
  const rows = pages.flatMap((p) => p.rows);
  const counts = pages[0]?.counts;
  return (
    <>
      <div className="toolbar-row">
        <div className="tabs">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tab${filters.status === tab.id ? " active" : ""}`}
              title={tab.hint}
              onClick={() => onFilter({ status: tab.id })}
            >
              {tab.label}
              {counts && tab.id !== "all" ? ` ${counts[tab.id]}` : ""}
            </button>
          ))}
        </div>
        <label>
          Strategy
          <select
            value={filters.strategy}
            title="Show simulations whose stored request includes this strategy."
            onChange={(e) => onFilter({ strategy: e.target.value as SimStrategyFilter })}
          >
            <option value="all">All</option>
            <option value="fixed">Fixed</option>
            <option value="threshold">Threshold</option>
            <option value="hindsight">Hindsight</option>
          </select>
        </label>
        <label>
          Order
          <select
            value={filters.sort}
            title="Newest first or oldest first, by submission time."
            onChange={(e) => onFilter({ sort: e.target.value as SimulationSort })}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </label>
      </div>
      <DataTable
        columns={COLUMNS}
        rows={rows}
        rowKey={(r) => r.id}
        selectedKey={selectedId}
        onSelect={onSelect}
        empty={
          <p className="empty-insp">
            No stored simulations in this selection — {scope.region} {scope.start} to {scope.end}
            {filters.status !== "all" || filters.strategy !== "all"
              ? " with the current filters"
              : ""}
            .
          </p>
        }
      />
      {query.hasNextPage && (
        <button
          type="button"
          className="btn"
          title="Load the next page of stored simulations."
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "Loading…" : `Load more (${pages[0]?.total ?? 0} total)`}
        </button>
      )}
      <p className="hint table-note">
        Select a simulation to inspect its scenario, results and price history. Dates refer to the
        market day; created times show when the request was stored.
      </p>
    </>
  );
}

/** The stored request document is opaque (`type: object` in the contract) —
 * Java-era rows carry the same keys with decimal strings, so every read goes
 * through this defensive shape and unknown eras still render the rest. */
interface StoredSite {
  capacityMWh?: string;
  minimumMWh?: string;
  maximumMWh?: string;
  initialMWh?: string;
  chargeMW?: string;
  dischargeMW?: string;
  importLimitMW?: string;
  exportLimitMW?: string;
}

interface StoredRequest {
  region?: string;
  day?: string;
  site?: StoredSite;
  efficiency?: { roundTrip?: string; charge?: string; discharge?: string };
  costs?: { importFee?: string; exportFee?: string; degradationPerExportedMWh?: string };
  windows?: {
    chargeStart?: number;
    chargeEnd?: number;
    dischargeStart?: number;
    dischargeEnd?: number;
  };
  thresholds?: { chargeBelow?: string; dischargeAbove?: string } | null;
}

function minutes(min: number | undefined): string {
  if (min === undefined) return "—";
  const hh = String(Math.floor(min / 60)).padStart(2, "0");
  const mm = String(min % 60).padStart(2, "0");
  return min === 1440 ? "24:00" : `${hh}:${mm}`;
}

function eventLabel(kind: string): string {
  return kind
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function fmtMoney(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

function ResultSection({ result }: { result: AdminSimulationDetail["result"] }) {
  if (!result) {
    return <p className="hint">No stored result — nothing to show yet.</p>;
  }
  const strategies = Object.entries(result.accounting);
  return (
    <>
      <dl className="kv">
        <dt>Solver</dt>
        <dd>{result.solver.status}</dd>
        <dt>Objective</dt>
        <dd>{fmtMoney(result.solver.objective)}</dd>
        <dt>Upper bound</dt>
        <dd>{fmtMoney(result.solver.upperBound)}</dd>
        <dt>Absolute gap</dt>
        <dd>{fmtMoney(result.solver.absoluteGap)}</dd>
        <dt>Result stored</dt>
        <dd>{fmtDateTime(result.createdAt)}</dd>
      </dl>
      {strategies.length > 0 && (
        <div className="table-scroll">
          <table className="data-table result-comparison">
            <caption>Stored comparison · AUD unless labelled MWh</caption>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                {strategies.map(([name]) => (
                  <th scope="col" key={name}>
                    {STRATEGY_LABEL[name] ?? name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Net margin", "margin"],
                  ["Revenue", "revenue"],
                  ["Charging", "chargingCost"],
                  ["Export MWh", "exportedMWh"],
                ] as const
              ).map(([label, field]) => (
                <tr key={field}>
                  <th scope="row">{label}</th>
                  {strategies.map(([name, acc]) => (
                    <td
                      key={name}
                      title={String(acc[field])}
                      aria-label={`${label}: ${acc[field]}`}
                    >
                      {acc[field].toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Selected simulation's lifecycle in the activity pane — reads the same
 * `["simulation", id]` query the inspector owns, so it shares its cache and
 * polls nothing extra. */
export function SimulationActivity({ id }: { id: string }) {
  const detail = useQuery({
    queryKey: ["simulation", id],
    queryFn: ({ signal }) => getSimulation(id, signal),
  });
  if (detail.isPending) return <Loading label="Reading simulation…" />;
  if (detail.isError) return <Failure error={detail.error} />;
  const d = detail.data;
  return (
    <>
      <p className="hint">
        <strong>
          {d.simulation.region} {d.simulation.day}
        </strong>{" "}
        <StatusChip status={d.simulation.status} /> · simulation {d.simulation.id.slice(0, 8)}
      </p>
      {d.lifecycle.recorded ? (
        <ol className="event-list">
          {d.lifecycle.events.map((event, i) => (
            <li key={`${event.kind}-${event.createdAt}-${i}`}>
              <time dateTime={event.createdAt}>{fmtDateTime(event.createdAt)}</time>{" "}
              <strong>{eventLabel(event.kind)}</strong>
              {event.attempt !== null && <span> attempt {event.attempt}</span>}
              {event.attemptMs !== null && (
                <span className="hint"> · {(event.attemptMs / 1000).toFixed(1)}s</span>
              )}
              {event.diagnostic && <span className="hint"> — {event.diagnostic}</span>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="hint">Execution history was not recorded for this job.</p>
      )}
    </>
  );
}

/** Detail inspector — fetches the projection directly so a deep link or an
 * out-of-page ID still resolves; status polls while the job is in flight. */
export function SimulationInspector({
  id,
  scope,
  poll,
  onOpenCoverage,
}: {
  id: string;
  scope: Scope;
  poll: boolean;
  onOpenCoverage: (day: string) => void;
}) {
  const detail: UseQueryResult<AdminSimulationDetail> = useQuery({
    queryKey: ["simulation", id],
    queryFn: ({ signal }) => getSimulation(id, signal),
    refetchInterval: (query) =>
      poll &&
      (query.state.data?.execution.status === "QUEUED" ||
        query.state.data?.execution.status === "RUNNING")
        ? POLL_MS
        : false,
  });
  if (detail.isPending) return <Loading label="Reading simulation…" />;
  if (detail.isError) return <Failure error={detail.error} />;
  const d = detail.data;
  const sim = d.simulation;
  const request = d.scenario.request as StoredRequest;
  const outOfScope = sim.region !== scope.region || sim.day < scope.start || sim.day > scope.end;
  return (
    <>
      <div className="insp-head">
        <h2>
          {sim.region} {sim.day}
        </h2>
        <div className="sub">
          Simulation · <StatusChip status={sim.status} /> · {sim.id.slice(0, 8)}
        </div>
      </div>
      <div className="insp-actions">
        {sim.hasResult && (
          <a
            className="btn"
            href={`${PUBLIC_BASE}/batterylab?simulation=${sim.id}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open this stored comparison in the public BatteryLab workspace."
          >
            Open in BatteryLab ↗
          </a>
        )}
        <button
          type="button"
          className="btn"
          title="Open the Coverage view on this simulation's market day."
          onClick={() => onOpenCoverage(sim.day)}
        >
          Inspect price coverage
        </button>
      </div>
      {outOfScope && (
        <p className="banner" role="status">
          Outside this selection — the stored record is intact; widen the scope to list it.
        </p>
      )}
      <div className="insp-sec">
        <h3>Scenario</h3>
        <dl className="kv">
          <dt>Capacity</dt>
          <dd>
            {request.site?.capacityMWh ?? sim.capacityMWh} MWh
            {request.site?.initialMWh !== undefined && ` · start ${request.site.initialMWh}`}
          </dd>
          <dt>Charge / discharge</dt>
          <dd>
            {request.site?.chargeMW ?? sim.chargeMW} /{" "}
            {request.site?.dischargeMW ?? sim.dischargeMW} MW
          </dd>
          {request.efficiency &&
            (request.efficiency.roundTrip != null ||
              request.efficiency.charge != null ||
              request.efficiency.discharge != null) && (
              <>
                <dt>Efficiency</dt>
                <dd>
                  {request.efficiency.roundTrip != null
                    ? `round-trip ${request.efficiency.roundTrip}`
                    : `charge ${request.efficiency.charge ?? "—"} · discharge ${request.efficiency.discharge ?? "—"}`}
                </dd>
              </>
            )}
          {request.costs && (
            <>
              <dt>Costs</dt>
              <dd>
                import {request.costs.importFee} · export {request.costs.exportFee} · degradation{" "}
                {request.costs.degradationPerExportedMWh}
              </dd>
            </>
          )}
          {request.windows && (
            <>
              <dt>Windows</dt>
              <dd>
                charge {minutes(request.windows.chargeStart)}–{minutes(request.windows.chargeEnd)} ·
                discharge {minutes(request.windows.dischargeStart)}–
                {minutes(request.windows.dischargeEnd)}
              </dd>
            </>
          )}
          {request.thresholds && (
            <>
              <dt>Thresholds</dt>
              <dd>
                charge below {request.thresholds.chargeBelow} · discharge above{" "}
                {request.thresholds.dischargeAbove}
              </dd>
            </>
          )}
        </dl>
      </div>
      <div className="insp-sec">
        <h3>Execution</h3>
        <dl className="kv">
          <dt>Attempts</dt>
          <dd>{d.execution.attempts} of 3</dd>
          <dt>Available</dt>
          <dd>{fmtDateTime(d.execution.availableAt)}</dd>
          <dt>Created</dt>
          <dd>{fmtDateTime(d.execution.createdAt)}</dd>
          {d.execution.finishedAt && (
            <>
              <dt>Finished</dt>
              <dd>{fmtDateTime(d.execution.finishedAt)}</dd>
            </>
          )}
          {d.execution.diagnostic && (
            <>
              <dt>Note</dt>
              <dd>{d.execution.diagnostic}</dd>
            </>
          )}
        </dl>
      </div>
      <div className="insp-sec">
        <h3>Result</h3>
        <ResultSection result={d.result} />
      </div>
      <div className="insp-sec">
        <h3>Lifecycle</h3>
        {d.lifecycle.recorded ? (
          <ol className="event-list">
            {d.lifecycle.events.map((event, i) => (
              <li key={`${event.kind}-${event.createdAt}-${i}`}>
                <time dateTime={event.createdAt}>{fmtDateTime(event.createdAt)}</time>{" "}
                <strong>{eventLabel(event.kind)}</strong>
                {event.attempt !== null && <span> attempt {event.attempt}</span>}
                {event.attemptMs !== null && (
                  <span className="hint"> · {(event.attemptMs / 1000).toFixed(1)}s</span>
                )}
                {event.diagnostic && <span className="hint"> — {event.diagnostic}</span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="hint">
            Detailed execution history was not recorded for this job — it predates lifecycle
            capture.
          </p>
        )}
      </div>
      <div className="insp-sec">
        <h3>Provenance</h3>
        <dl className="kv">
          <dt>Price revision</dt>
          <dd>
            {d.provenance.comparison === "matches"
              ? "Pinned revision is current"
              : d.provenance.comparison === "different"
                ? "Pinned revision differs from current prices"
                : "Current revision unavailable"}
          </dd>
          <dt>Pinned</dt>
          <dd>{d.provenance.pinnedRevision.slice(0, 8)}</dd>
          <dt>Current</dt>
          <dd>{d.provenance.currentRevision?.slice(0, 8) ?? "—"}</dd>
          <dt>Checked</dt>
          <dd>{fmtDateTime(d.provenance.checkedAt)}</dd>
        </dl>
        <dl className="kv">
          {Object.entries(d.scenario.versions).map(([key, value]) =>
            typeof value === "string" ? (
              <div key={key} style={{ display: "contents" }}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ) : null,
          )}
        </dl>
      </div>
    </>
  );
}
