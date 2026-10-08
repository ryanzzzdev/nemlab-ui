import type { UseQueryResult } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { apiGet, plusDays } from "../api";
import type {
  GridBaselineReadiness,
  GridCoverage,
  GridCoverageDay,
  Region,
  SessionView,
} from "../api";
import { DataTable } from "../components/Table";
import type { Column } from "../components/Table";
import { Failure, Loading } from "../components/States";
import { LOAD_DRAFT_KEY } from "../pages/LoadPage";
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

function seriesSummary(day: GridCoverageDay, metric: string): string {
  const rows = day.series.filter((s) => s.metric === metric);
  const valid = rows.reduce((sum, s) => sum + (s.valid ?? 0), 0);
  const missing = rows.reduce((sum, s) => sum + (s.missing ?? 0), 0);
  if (rows.length === 0 || (valid === 0 && missing === 0)) return "—";
  return missing > 0 ? `${valid} (+${missing} missing)` : `${valid}`;
}

const COLUMNS: Column<GridCoverageDay>[] = [
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

/** Coverage matrix — one row per market day, date-descending. Series
 * columns count stored values; "+n missing" marks gaps honestly. */
export function CoverageView({
  scope,
  coverage,
  selectedDay,
  onSelect,
}: {
  scope: Scope;
  coverage: UseQueryResult<GridCoverage>;
  selectedDay: string | null;
  onSelect: (day: string) => void;
}) {
  if (coverage.isPending) return <Loading label="Reading stored coverage…" />;
  if (coverage.isError) return <Failure error={coverage.error} />;
  const days = [...coverage.data.days].sort((a, b) => b.day.localeCompare(a.day));
  return (
    <>
      <DataTable
        id="coverage"
        columns={COLUMNS}
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
    </>
  );
}

export function DayInspector({
  scope,
  coverage,
  baseline,
  day,
  session,
}: {
  scope: Scope;
  coverage: UseQueryResult<GridCoverage>;
  baseline: UseQueryResult<GridBaselineReadiness>;
  day: string;
  session: SessionView;
}) {
  const navigate = useNavigate();
  const row = coverage.data?.days.find((d) => d.day === day);
  if (!row) {
    return <p className="empty-insp">That day is outside the current scope.</p>;
  }
  const base = baseline.data?.days.find((d) => d.day === day);
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
                      s.retrievedAt
                        ? ` · ${new Date(s.retrievedAt).toLocaleDateString("en-AU")}`
                        : ""
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
      <div className="insp-actions">
        {session.role === "owner" ? (
          <button
            type="button"
            className="btn"
            onClick={() => {
              sessionStorage.setItem(
                LOAD_DRAFT_KEY,
                JSON.stringify({ region: scope.region, start: day, end: day }),
              );
              void navigate("/load");
            }}
          >
            Load data
          </button>
        ) : (
          <p className="hint">Loading data is an owner action.</p>
        )}
      </div>
    </>
  );
}
