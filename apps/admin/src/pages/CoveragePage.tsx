import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useOutletContext } from "react-router";
import { REGIONS, apiGet, marketDay, plusDays } from "../api";
import type {
  GridBaselineReadiness,
  GridCoverage,
  GridCoverageDay,
  Region,
  SessionView,
} from "../api";
import { Empty, Failure, Loading, Panel } from "../components/States";

const MAX_DAYS = 31;

function availabilityLabel(day: GridCoverageDay): string {
  if (day.availability === "COMPLETE") return "Complete";
  if (day.availability === "PARTIAL") return "Partial";
  return "Not imported";
}

function DayTable({ days }: { days: GridCoverageDay[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const day = days.find((d) => d.day === selected);
  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Stored data</th>
              <th scope="col" className="num">
                Series
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day}>
                <td>
                  <button
                    type="button"
                    className="linklike"
                    aria-pressed={selected === d.day}
                    onClick={() => setSelected(selected === d.day ? null : d.day)}
                  >
                    {d.day}
                  </button>
                </td>
                <td>
                  <span
                    className={`cov-dot cov-${d.availability.toLowerCase()}`}
                    aria-hidden="true"
                  />
                  {availabilityLabel(d)}
                </td>
                <td className="num">{d.series.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {day && (
        <section className="card" aria-label={`${day.day} series detail`}>
          <h3>{day.day} — series detail</h3>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">Series</th>
                  <th scope="col">Stored</th>
                  <th scope="col" className="num">
                    Valid
                  </th>
                  <th scope="col" className="num">
                    Missing
                  </th>
                  <th scope="col">Retrieved</th>
                </tr>
              </thead>
              <tbody>
                {day.series.map((s) => (
                  <tr key={`${s.metric}:${s.series}`}>
                    <td>{s.metric.replaceAll("_", " ")}</td>
                    <td>{s.series || "—"}</td>
                    <td>{s.availability.replaceAll("_", " ").toLowerCase()}</td>
                    <td className="num">{s.valid ?? "—"}</td>
                    <td className="num">{s.missing ?? "—"}</td>
                    <td>{s.retrievedAt ? new Date(s.retrievedAt).toLocaleString("en-AU") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function Baseline({ readiness }: { readiness: GridBaselineReadiness }) {
  const ready = readiness.days.filter((d) => d.ready).length;
  return (
    <Panel title="Ramp-event baseline readiness">
      <p className="hint">
        Each candidate day needs {readiness.minCompleteDays} complete days and{" "}
        {readiness.minClassDays} same-class (weekday/weekend) days in its {readiness.baselineDays}
        -day baseline window before an unusual-ramp result is meaningful.
      </p>
      {readiness.days.length === 0 ? (
        <Empty label="No candidate days in range." />
      ) : (
        <>
          <p>
            {ready} of {readiness.days.length} candidate
            {readiness.days.length === 1 ? " day is" : " days are"} baseline ready.
          </p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Candidate day</th>
                  <th scope="col" className="num">
                    Complete days
                  </th>
                  <th scope="col" className="num">
                    Same-class days
                  </th>
                  <th scope="col">Baseline</th>
                </tr>
              </thead>
              <tbody>
                {readiness.days.map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}</td>
                    <td className="num">
                      {d.completeDays}/{readiness.minCompleteDays}
                    </td>
                    <td className="num">
                      {d.classDays}/{readiness.minClassDays}
                    </td>
                    <td>{d.ready ? "Ready" : "Insufficient"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}

export function CoveragePage() {
  const session = useOutletContext<SessionView>();
  const [region, setRegion] = useState<Region>("NSW1");
  const [start, setStart] = useState(() => plusDays(marketDay(), -31));
  const [end, setEnd] = useState(() => plusDays(marketDay(), -1));
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<{
    region: Region;
    start: string;
    endExclusive: string;
  } | null>(null);

  const coverage = useQuery({
    queryKey: ["grid-coverage", query],
    enabled: query !== null,
    queryFn: ({ signal }) =>
      apiGet<GridCoverage>(
        `/api/admin/v1/grid-coverage/${query!.region}?start=${query!.start}&endExclusive=${query!.endExclusive}`,
        signal,
      ),
  });
  const baseline = useQuery({
    queryKey: ["grid-baseline", query],
    enabled: query !== null,
    queryFn: ({ signal }) =>
      apiGet<GridBaselineReadiness>(
        `/api/admin/v1/grid-coverage/${query!.region}/baseline?startDay=${query!.start}&endExclusive=${query!.endExclusive}`,
        signal,
      ),
  });

  function inspect() {
    if (!start || !end) {
      setError("Choose both a start and end day.");
      return;
    }
    if (end < start) {
      setError("The end day must be on or after the start day.");
      return;
    }
    if (plusDays(start, MAX_DAYS) <= end) {
      setError(`Inspect at most ${MAX_DAYS} days at once.`);
      return;
    }
    setError(null);
    // The UI range is inclusive; the API end is exclusive — converted once.
    setQuery({ region, start, endExclusive: plusDays(end, 1) });
  }

  return (
    <>
      <p className="eyebrow">Coverage</p>
      <h1 tabIndex={-1}>What grid data is stored?</h1>
      <p className="intro">
        Stored coverage for one region — separate from what the latest publication made public.
      </p>
      <section className="card scenario-form">
        <div className="scenario-fields">
          <label htmlFor="cov-region">Region</label>
          <select
            id="cov-region"
            value={region}
            onChange={(e) => setRegion(e.target.value as Region)}
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <label htmlFor="cov-start">First day</label>
          <input
            id="cov-start"
            type="date"
            value={start}
            max={plusDays(marketDay(), -1)}
            onChange={(e) => setStart(e.target.value)}
          />
          <label htmlFor="cov-end">Last day</label>
          <input
            id="cov-end"
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
          <button type="button" className="primary" onClick={inspect}>
            Inspect coverage
          </button>
          <p className="hint">
            Up to {MAX_DAYS} days at once.{" "}
            {session.role === "owner"
              ? "As owner you can load missing days from the Jobs workflow — that action arrives with the guided load screen."
              : "Loading data is an owner action; you can inspect what is stored."}
          </p>
        </div>
      </section>
      {query === null ? (
        <Empty label="Choose a region and range, then inspect." />
      ) : coverage.isPending ? (
        <Loading label="Reading stored coverage…" />
      ) : coverage.isError ? (
        <Failure error={coverage.error} />
      ) : (
        <>
          <section className="card">
            <h2>
              Stored coverage — {coverage.data.region}, {coverage.data.start} to{" "}
              {plusDays(coverage.data.endExclusive, -1)}
            </h2>
            <p className="hint legend">
              Complete = all required market series fully stored. Partial = some required series
              present. Not imported = nothing stored. Optional power series never change the
              summary.
            </p>
            <DayTable days={coverage.data.days} />
          </section>
          {baseline.isPending ? (
            <Loading label="Checking baseline readiness…" />
          ) : baseline.isError ? (
            <Failure error={baseline.error} />
          ) : (
            <Baseline readiness={baseline.data} />
          )}
        </>
      )}
    </>
  );
}
