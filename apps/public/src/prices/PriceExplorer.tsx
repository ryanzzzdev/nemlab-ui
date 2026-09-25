import { lazy, Suspense, useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { marketDay, nextDay, readPriceDay, validDay } from "./client";
import type { Region } from "./client";

const PriceCharts = lazy(() =>
  import("./PriceCharts").catch(() => ({
    default: function UnavailableCharts() {
      return (
        <p role="alert">
          Charts could not load. The exact price table is still available. Reload the page to try
          again.
        </p>
      );
    },
  })),
);

const regions: Region[] = ["NSW1", "QLD1", "SA1", "TAS1", "VIC1"];
const availability = {
  COMPLETE: "Complete",
  INCOMPLETE: "Incomplete",
  NOT_IMPORTED: "Not imported",
};
const marketTime = (instant: string) =>
  new Date(Date.parse(instant) + 10 * 3600000).toISOString().slice(11, 16);

export function PriceExplorer() {
  const [region, setRegion] = useState<Region>("NSW1");
  const [day, setDay] = useState(nextDay(marketDay(), -1));
  const [selection, setSelection] = useState<{ region: Region; day: string } | null>(null);
  const [validation, setValidation] = useState("");
  const query = useQuery({
    queryKey: ["price-day", selection?.region, selection?.day],
    queryFn: ({ signal }) => readPriceDay(selection!.region, selection!.day, signal),
    enabled: selection !== null,
    retry: false,
    staleTime: 0,
    gcTime: 300000,
    refetchOnWindowFocus: false,
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validDay(day)) {
      setValidation("Choose a completed NEM day from 2021-10-01 through yesterday (UTC+10).");
      return;
    }
    setValidation("");
    if (selection?.region === region && selection.day === day) void query.refetch();
    else setSelection({ region, day });
  }

  return (
    <section className="price-explorer" aria-labelledby="prices-heading">
      <h2 id="prices-heading">Check stored prices</h2>
      <p>
        Check one completed market day. Reading prices does not import new data or run a simulation.
      </p>
      <form onSubmit={submit} noValidate className="price-form">
        <div className="form-field">
          <label htmlFor="price-region">Region</label>
          <select
            id="price-region"
            value={region}
            onChange={(event) => setRegion(event.target.value as Region)}
          >
            {regions.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <label>
          Market day (UTC+10)
          <input
            type="date"
            value={day}
            min="2021-10-01"
            max={nextDay(marketDay(), -1)}
            aria-invalid={Boolean(validation)}
            aria-describedby={validation ? "date-error" : undefined}
            onChange={(event) => setDay(event.target.value)}
          />
        </label>
        <button type="submit">Check prices</button>
      </form>
      {validation && (
        <p role="alert" id="date-error">
          {validation}
        </p>
      )}
      {selection && (
        <p className="availability">
          Selected: {selection.region} · {selection.day} · NEM UTC+10
        </p>
      )}
      {query.isFetching && <p role="status">Loading stored prices…</p>}
      {query.isError && (
        <div role="alert">
          <p>{query.error.message}</p>
          <button onClick={() => void query.refetch()}>Try again</button>
        </div>
      )}
      {query.data && !query.isError && (
        <div>
          <h3 aria-live="polite">{availability[query.data.coverage.availability]}</h3>
          {query.data.series === null ? (
            <p>
              No stored prices for this day. Choose another day; a refresh requires an operator.
            </p>
          ) : (
            <>
              <p>
                {query.data.coverage.valid} valid · {query.data.coverage.missing} missing ·{" "}
                {query.data.coverage.sourceNull} source null
              </p>
              {query.data.coverage.availability === "INCOMPLETE" && (
                <p>This day has gaps and cannot support a complete battery simulation.</p>
              )}
              <p>
                Source: {query.data.series.source} · Prices: {query.data.series.unit}
              </p>
              <p className="revision">
                Revision: {query.data.coverage.revision}
                <br />
                Retrieved: {query.data.coverage.retrievedAt}
              </p>
              <Suspense
                fallback={
                  <div className="chart-loading" role="status">
                    Loading chart…
                  </div>
                }
              >
                <PriceCharts key={query.data.coverage.revision} series={query.data.series} />
              </Suspense>
              <details className="method">
                <summary>Exact interval values · 288 five-minute intervals</summary>
                <p className="availability">
                  Exact stored price strings; missing observations stay distinct from zero. Interval
                  times in NEM UTC+10; the final 00:00 is the following day.
                </p>
                <div
                  className="price-table"
                  tabIndex={0}
                  role="region"
                  aria-label="Price intervals (scrollable)"
                >
                  <table>
                    <caption>288 five-minute intervals · NEM UTC+10</caption>
                    <thead>
                      <tr>
                        <th scope="col">Start</th>
                        <th scope="col">End</th>
                        <th scope="col">Price (AUD/MWh)</th>
                        <th scope="col">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.series.intervals.map((slot) => (
                        <tr key={slot.start}>
                          <td>{marketTime(slot.start)}</td>
                          <td>{marketTime(slot.end)}</td>
                          <td>{slot.price ?? "—"}</td>
                          <td>
                            {slot.state === "VALUE"
                              ? "Value"
                              : slot.state === "MISSING"
                                ? "Missing"
                                : "Source null"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </div>
      )}
    </section>
  );
}
