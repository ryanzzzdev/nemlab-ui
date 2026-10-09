import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { apiGet, getPriceCoverage, listSimulations, plusDays, submitPriceRefresh } from "../api";
import { fmtDate, fmtDateTime } from "../format";
import type {
  GridBaselineReadiness,
  GridCoverage,
  GridCoverageDay,
  PriceCoverage,
  PriceCoverageDay,
  Region,
  SessionView,
} from "../api";
import { DataTable } from "../components/Table";
import type { Column } from "../components/Table";
import { StatusChip } from "../components/StatusChip";
import { Failure, Loading } from "../components/States";
import type { Scope } from "./scope";

export function coverageQuery(region: Region, start: string, endEx: string) {
  return {
    queryKey: ["grid-coverage", region, start, endEx],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      apiGet<GridCoverage>(
        `/api/admin/v1/grid-coverage/${region}?start=${start}&endExclusive=${endEx}`,
        signal,
      ),
  };
}

/** Price readiness for the same scope — the shared public projection, so
 * what Admin shows is exactly what BatteryLab visitors would use. */
export function priceCoverageQuery(region: Region, start: string, endEx: string) {
  return {
    queryKey: ["price-coverage", region, start, endEx],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      getPriceCoverage(region, start, endEx, signal),
  };
}

export function baselineQuery(region: Region, start: string, endEx: string) {
  return {
    queryKey: ["grid-baseline", region, start, endEx],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      apiGet<GridBaselineReadiness>(
        `/api/admin/v1/grid-coverage/${region}/baseline?startDay=${start}&endExclusive=${endEx}`,
        signal,
      ),
  };
}

function availabilityLabel(day: GridCoverageDay): string {
  if (day.availability === "COMPLETE") return "Complete";
  if (day.availability === "PARTIAL") return "Partial";
  return "Not imported";
}

function priceLabel(day: PriceCoverageDay): string {
  if (day.availability === "COMPLETE") return "Complete";
  if (day.availability === "INCOMPLETE") return "Partial";
  return "Not imported";
}

function priceChip(day: PriceCoverageDay | undefined) {
  if (!day) return <span className="hint">—</span>;
  const tone =
    day.availability === "COMPLETE" ? "c-ok" : day.availability === "INCOMPLETE" ? "c-warn" : "";
  const detail =
    day.valid === null
      ? null
      : `${day.valid} valid${day.missing ? `, ${day.missing} missing` : ""} intervals`;
  return (
    <span
      className={`chip ${tone}`}
      title={
        detail +
        (day.revision ? ` · revision ${day.revision.slice(0, 8)}` : " · no stored revision")
      }
    >
      {priceLabel(day)}
    </span>
  );
}

function seriesSummary(day: GridCoverageDay, metric: string): string {
  const rows = day.series.filter((s) => s.metric === metric);
  const valid = rows.reduce((sum, s) => sum + (s.valid ?? 0), 0);
  const missing = rows.reduce((sum, s) => sum + (s.missing ?? 0), 0);
  if (rows.length === 0 || (valid === 0 && missing === 0)) return "—";
  return missing > 0 ? `${valid} (+${missing} missing)` : `${valid}`;
}

function coverageColumns(priceDays: Map<string, PriceCoverageDay>): Column<GridCoverageDay>[] {
  return [
    { id: "day", header: "Day", render: (d) => d.day },
    {
      id: "stored",
      header: "Stored data",
      render: (d) => (
        <span
          className={`chip ${d.availability === "COMPLETE" ? "c-ok" : d.availability === "PARTIAL" ? "c-warn" : ""}`}
        >
          {availabilityLabel(d)}
        </span>
      ),
    },
    {
      id: "prices",
      header: "Prices",
      render: (d) => priceChip(priceDays.get(d.day)),
    },
    { id: "demand", header: "Demand", align: "right", render: (d) => seriesSummary(d, "demand") },
    {
      id: "imports",
      header: "Flow in",
      align: "right",
      render: (d) => seriesSummary(d, "flow_imports"),
    },
    {
      id: "exports",
      header: "Flow out",
      align: "right",
      render: (d) => seriesSummary(d, "flow_exports"),
    },
    { id: "power", header: "Power", align: "right", render: (d) => seriesSummary(d, "power") },
  ];
}

/** Coverage matrix — one row per market day, date-descending. Series
 * columns count stored values; "+n missing" marks gaps honestly. The Prices
 * column is the same public coverage projection BatteryLab consumes. */
export function CoverageView({
  scope,
  coverage,
  priceCoverage,
  selectedDay,
  onSelect,
}: {
  scope: Scope;
  coverage: UseQueryResult<GridCoverage>;
  priceCoverage: UseQueryResult<PriceCoverage>;
  selectedDay: string | null;
  onSelect: (day: string) => void;
}) {
  if (coverage.isPending) return <Loading label="Reading stored coverage…" />;
  if (coverage.isError) return <Failure error={coverage.error} />;
  const days = [...coverage.data.days].sort((a, b) => b.day.localeCompare(a.day));
  const priceDays = new Map((priceCoverage.data?.days ?? []).map((d) => [d.day, d] as const));
  return (
    <>
      <DataTable
        columns={coverageColumns(priceDays)}
        rows={days}
        rowKey={(d) => d.day}
        selectedKey={selectedDay}
        onSelect={onSelect}
        empty={
          <p className="empty-insp">
            No days in scope — {scope.region} {scope.start} to {scope.end} returned nothing.
          </p>
        }
      />
      <p className="hint table-note">
        Stored coverage for {scope.region} — separate from what the latest publication made public.
        Series cells count stored intervals; complete/partial never implies published.
      </p>
      {priceCoverage.isError && (
        <p className="hint table-note">
          Price coverage could not be read — grid data is unaffected.
        </p>
      )}
    </>
  );
}

export function DayInspector({
  scope,
  coverage,
  baseline,
  priceCoverage,
  day,
  session,
  onLoadDay,
  onOpenSimulations,
  onSelectSimulation,
}: {
  scope: Scope;
  coverage: UseQueryResult<GridCoverage>;
  baseline: UseQueryResult<GridBaselineReadiness>;
  priceCoverage: UseQueryResult<PriceCoverage>;
  day: string;
  session: SessionView;
  onLoadDay: (day: string) => void;
  onOpenSimulations: (day: string) => void;
  onSelectSimulation: (id: string) => void;
}) {
  const client = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const row = coverage.data?.days.find((d) => d.day === day);
  const priceDay = priceCoverage.data?.days.find((d) => d.day === day);
  // Same-day stored simulations — bounded by the catalogue endpoint itself.
  const daySims = useQuery({
    queryKey: ["day-simulations", scope.region, day],
    queryFn: ({ signal }) =>
      listSimulations({ region: scope.region, startDay: day, endDay: day }, { limit: 50 }, signal),
  });
  if (!row) {
    return <p className="empty-insp">That day is outside the current scope.</p>;
  }
  const base = baseline.data?.days.find((d) => d.day === day);

  async function refreshPrices() {
    setRefreshing(true);
    setRefreshNote(null);
    setRefreshError(null);
    try {
      const job = await submitPriceRefresh(session.csrfToken, scope.region, day);
      setRefreshNote(
        `Price refresh queued${job ? ` — job ${job.id.slice(0, 8)}` : ""}. Existing simulations keep their pinned revision.`,
      );
      await client.invalidateQueries({ queryKey: ["price-refreshes"] });
      await client.invalidateQueries({ queryKey: ["price-coverage"] });
    } catch (error) {
      setRefreshError(error);
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <>
      <div className="insp-head">
        <h2>{day}</h2>
        <div className="sub">
          {scope.region} · {availabilityLabel(row)}
        </div>
      </div>
      <div className="insp-sec">
        <h3>Stored series</h3>
        <dl className="kv">
          {row.series.map((s) => (
            <div key={`${s.metric}:${s.series}`} style={{ display: "contents" }}>
              <dt>
                {s.metric.replaceAll("_", " ")}
                {s.series ? ` · ${s.series}` : ""}
              </dt>
              <dd>
                {s.valid != null
                  ? `${s.valid} valid${s.missing ? `, ${s.missing} missing` : ""}${
                      s.retrievedAt ? ` · ${fmtDate(s.retrievedAt)}` : ""
                    }`
                  : "not stored"}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {baseline.data && (
        <div className="insp-sec">
          <h3>Ramp baseline</h3>
          {base ? (
            <dl className="kv">
              <dt>Complete days</dt>
              <dd>
                {base.completeDays}/{baseline.data.minCompleteDays}
              </dd>
              <dt>Same-class days</dt>
              <dd>
                {base.classDays}/{baseline.data.minClassDays}
              </dd>
              <dt>Baseline</dt>
              <dd>{base.ready ? "Ready" : "Insufficient history"}</dd>
            </dl>
          ) : (
            <p className="hint">
              Outside the evaluated window ({baseline.data.candidateStart} –{" "}
              {plusDays(baseline.data.candidateEndExclusive, -1)}).
            </p>
          )}
          <p className="hint">
            A candidate needs {baseline.data.minCompleteDays} complete days and{" "}
            {baseline.data.minClassDays} same-class days in its {baseline.data.baselineDays}-day
            window before an unusual-ramp result is meaningful.
          </p>
        </div>
      )}
      <div className="insp-sec">
        <h3>Price readiness</h3>
        {priceCoverage.isPending ? (
          <Loading label="Reading price coverage…" />
        ) : priceCoverage.isError ? (
          <p className="hint">Price coverage could not be read.</p>
        ) : priceDay ? (
          <dl className="kv">
            <dt>Availability</dt>
            <dd>{priceChip(priceDay)}</dd>
            {priceDay.valid !== null && (
              <>
                <dt>Intervals</dt>
                <dd>
                  {priceDay.valid} valid
                  {priceDay.missing ? `, ${priceDay.missing} missing` : ""} of 288
                </dd>
              </>
            )}
            {priceDay.revision && (
              <>
                <dt>Current revision</dt>
                <dd title={priceDay.revision}>{priceDay.revision.slice(0, 8)}</dd>
              </>
            )}
            {priceDay.retrievedAt && (
              <>
                <dt>Retrieved</dt>
                <dd>{fmtDateTime(priceDay.retrievedAt)}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="hint">No price coverage row for this day.</p>
        )}
        <p className="hint">
          Stored simulations keep the price revision they pinned at submission — refreshing prices
          never rewrites a saved result.
        </p>
      </div>
      <div className="insp-sec">
        <h3>Simulations for this day</h3>
        {daySims.isPending ? (
          <Loading label="Reading stored simulations…" />
        ) : daySims.isError ? (
          <Failure error={daySims.error} />
        ) : daySims.data.rows.length === 0 ? (
          <p className="hint">No stored simulations for {day}.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">ID</th>
                <th scope="col">Strategies</th>
              </tr>
            </thead>
            <tbody>
              {daySims.data.rows.map((s) => (
                <tr key={s.id} onClick={() => onSelectSimulation(s.id)}>
                  <td>
                    <StatusChip status={s.status} />
                  </td>
                  <td title={s.id}>{s.id.slice(0, 8)}</td>
                  <td>{s.strategies.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="insp-actions">
        <button
          type="button"
          className="btn"
          title="List the stored simulations recorded for this market day."
          onClick={() => onOpenSimulations(day)}
        >
          View simulations for this day
        </button>
        {session.role === "owner" ? (
          <>
            <button
              type="button"
              className="btn"
              title="Queue a job that re-fetches this day's market prices into a new revision. Saved simulations keep the revision they pinned."
              disabled={refreshing}
              onClick={() => void refreshPrices()}
            >
              {refreshing ? "Queueing…" : "Refresh prices"}
            </button>
            <button
              type="button"
              className="btn"
              title="Open the load drawer to fetch this day's missing data."
              onClick={() => onLoadDay(day)}
            >
              Load data
            </button>
          </>
        ) : (
          <p className="hint">Loading data and price refreshes are owner actions.</p>
        )}
      </div>
      {refreshNote && (
        <p className="banner" role="status">
          {refreshNote}
        </p>
      )}
      {refreshError !== null && <Failure error={refreshError} />}
    </>
  );
}
