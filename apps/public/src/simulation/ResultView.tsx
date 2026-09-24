import { lazy, Suspense, useMemo, useState } from "react";
import type { Result } from "./client";
import { aud, aud4, cumulativeMargins, endLabel, explain, mwh, netMW, signedMw } from "./compare";

const ResultCharts = lazy(() =>
  import("./ResultCharts").catch(() => ({
    default: function UnavailableCharts() {
      return (
        <p role="alert">
          Charts could not load. The comparison tables remain available. Reload the page to try
          again.
        </p>
      );
    },
  })),
);

export function ResultView({ result }: { result: Result }) {
  const [showCharts, setShowCharts] = useState(false);
  const fixed = result.fixed.accounting;
  const hindsight = result.hindsight.accounting;
  const items = useMemo(() => explain(result), [result]);
  const margins = useMemo(
    () => ({
      fixed: cumulativeMargins(result, result.fixed),
      hindsight: cumulativeMargins(result, result.hindsight),
    }),
    [result],
  );
  const seconds = result.intervalSeconds;
  const money = (value: number) => aud(value) + (value < 0 ? " (credit)" : "");
  const rows: [string, string, string, string][] = [
    ["Energy imported", "MWh", mwh(fixed.importedMWh), mwh(hindsight.importedMWh)],
    ["Energy exported", "MWh", mwh(fixed.exportedMWh), mwh(hindsight.exportedMWh)],
    ["Charging cost", "AUD", money(fixed.chargingCost), money(hindsight.chargingCost)],
    ["Discharge revenue", "AUD", aud(fixed.revenue), aud(hindsight.revenue)],
    ["Variable fees", "AUD", aud(fixed.fees), aud(hindsight.fees)],
    ["Degradation", "AUD", aud(fixed.degradation), aud(hindsight.degradation)],
    ["Energy losses (physical)", "MWh", mwh(fixed.lossesMWh), mwh(hindsight.lossesMWh)],
  ];
  return (
    <section className="result-comparison" aria-labelledby="result-heading">
      <div className="section-heading">
        <h2 id="result-heading">Result comparison</h2>
        <span className="badge">Proven optimal</span>
      </div>
      <p>
        Perfect hindsight is a benchmark, not a forecast — it saw every price before choosing. Both
        strategies used the same site limits and operating windows, and finish with the stored
        energy they started with.
      </p>
      <div className="stat-grid">
        <div className="stat">
          <span className="stat-label">Fixed schedule margin</span>
          <strong className="stat-value">{aud(fixed.margin)}</strong>
          <span className="stat-sub">ordered windows, no foresight</span>
        </div>
        <div className="stat">
          <span className="stat-label">Perfect hindsight margin</span>
          <strong className="stat-value">{aud(hindsight.margin)}</strong>
          <span className="stat-sub">optimal · bound gap {aud4(result.solver.absoluteGap)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Hindsight advantage</span>
          <strong className="stat-value">{aud(hindsight.margin - fixed.margin)}</strong>
          <span className="stat-sub">under identical limits</span>
        </div>
        <div className="stat">
          <span className="stat-label">Energy losses</span>
          <strong className="stat-value">{mwh(hindsight.lossesMWh)} MWh</strong>
          <span className="stat-sub">physical loss, never a fee</span>
        </div>
      </div>
      <ul className="result-explain">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <button type="button" aria-expanded={showCharts} onClick={() => setShowCharts(!showCharts)}>
        {showCharts ? "Hide comparison charts" : "Show comparison charts"}
      </button>
      {showCharts && (
        <Suspense fallback={<p role="status">Loading charts…</p>}>
          <ResultCharts result={result} />
        </Suspense>
      )}
      <h3>Financial breakdown</h3>
      <p className="availability">
        Display rounded to cents and thousandths; stored values are unrounded. A negative charging
        cost is a credit earned by importing at negative prices.
      </p>
      <div
        className="price-table"
        tabIndex={0}
        role="region"
        aria-label="Financial breakdown by strategy"
      >
        <table>
          <caption>
            Accounting per strategy · AUD and MWh · margin = revenue − charging cost − fees −
            degradation
          </caption>
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col">Unit</th>
              <th scope="col">Fixed schedule</th>
              <th scope="col">Perfect hindsight</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, unit, fixedValue, hindsightValue]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{unit}</td>
                <td className="num">{fixedValue}</td>
                <td className="num">{hindsightValue}</td>
              </tr>
            ))}
            <tr className="total">
              <th scope="row">Modelled margin</th>
              <td>AUD</td>
              <td className="num">{aud(fixed.margin)}</td>
              <td className="num">{aud(hindsight.margin)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>Interval detail</h3>
      <p className="availability">
        Exact stored price strings with display-rounded dispatch, stored energy and cumulative
        margin. Power is grid-side: positive imports, negative exports.
      </p>
      <div
        className="price-table"
        tabIndex={0}
        role="region"
        aria-label="Interval dispatch detail (scrollable)"
      >
        <table>
          <caption>
            288 five-minute intervals · NEM UTC+10 · interval end labels; final 00:00 is the
            following day
          </caption>
          <thead>
            <tr>
              <th scope="col">End</th>
              <th scope="col">Price (AUD/MWh)</th>
              <th scope="col">Fixed MW</th>
              <th scope="col">Fixed MWh</th>
              <th scope="col">Fixed margin (AUD)</th>
              <th scope="col">Hindsight MW</th>
              <th scope="col">Hindsight MWh</th>
              <th scope="col">Hindsight margin (AUD)</th>
            </tr>
          </thead>
          <tbody>
            {result.prices.map((slot, index) => (
              <tr key={slot.end}>
                <td>{endLabel(slot.end, index)}</td>
                <td>{slot.price}</td>
                <td className="num">
                  {signedMw(netMW(result.fixed.dispatch.intervals[index]!, seconds))}
                </td>
                <td className="num">
                  {mwh(result.fixed.dispatch.intervals[index]!.endingEnergyMWh)}
                </td>
                <td className="num">{aud(margins.fixed[index]!)}</td>
                <td className="num">
                  {signedMw(netMW(result.hindsight.dispatch.intervals[index]!, seconds))}
                </td>
                <td className="num">
                  {mwh(result.hindsight.dispatch.intervals[index]!.endingEnergyMWh)}
                </td>
                <td className="num">{aud(margins.hindsight[index]!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="revision">
        Price revision: {result.priceRevision}
        <br />
        Versions: request {result.versions.request} · model {result.versions.model} · fixed{" "}
        {result.versions.fixed} · hindsight {result.versions.hindsight} · solver{" "}
        {result.versions.solver} · execution {result.versions.executionProfile}
        <br />
        Solver bound {aud(result.solver.upperBound)} · absolute gap{" "}
        {aud4(result.solver.absoluteGap)} · limits {result.versions.limits.milliseconds} ms /{" "}
        {result.versions.limits.iterations} iterations
      </p>
    </section>
  );
}
