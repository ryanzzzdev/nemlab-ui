import { lazy, Suspense, useMemo } from "react";
import { Link } from "react-router";
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
  const fixed = result.fixed.accounting;
  const hindsight = result.hindsight.accounting;
  const threshold = result.threshold;
  const items = useMemo(() => explain(result), [result]);
  const margins = useMemo(
    () => ({
      fixed: cumulativeMargins(result, result.fixed),
      hindsight: cumulativeMargins(result, result.hindsight),
      threshold: threshold ? cumulativeMargins(result, threshold) : null,
    }),
    [result, threshold],
  );
  const seconds = result.intervalSeconds;
  const money = (value: number) => aud(value) + (value < 0 ? " (credit)" : "");
  const thresholdAccounting = threshold?.accounting;
  const rows: [string, string, string, string, string | undefined][] = [
    [
      "Energy imported",
      "MWh",
      mwh(fixed.importedMWh),
      mwh(hindsight.importedMWh),
      thresholdAccounting && mwh(thresholdAccounting.importedMWh),
    ],
    [
      "Energy exported",
      "MWh",
      mwh(fixed.exportedMWh),
      mwh(hindsight.exportedMWh),
      thresholdAccounting && mwh(thresholdAccounting.exportedMWh),
    ],
    [
      "Charging cost",
      "AUD",
      money(fixed.chargingCost),
      money(hindsight.chargingCost),
      thresholdAccounting && money(thresholdAccounting.chargingCost),
    ],
    [
      "Discharge revenue",
      "AUD",
      aud(fixed.revenue),
      aud(hindsight.revenue),
      thresholdAccounting && aud(thresholdAccounting.revenue),
    ],
    [
      "Variable fees",
      "AUD",
      aud(fixed.fees),
      aud(hindsight.fees),
      thresholdAccounting && aud(thresholdAccounting.fees),
    ],
    [
      "Degradation",
      "AUD",
      aud(fixed.degradation),
      aud(hindsight.degradation),
      thresholdAccounting && aud(thresholdAccounting.degradation),
    ],
    [
      "Energy losses (physical)",
      "MWh",
      mwh(fixed.lossesMWh),
      mwh(hindsight.lossesMWh),
      thresholdAccounting && mwh(thresholdAccounting.lossesMWh),
    ],
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
        {threshold &&
          " The threshold rule is a separate all-day experiment that may end at a different stored energy — it is not a like-for-like comparison."}
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
        {threshold && (
          <div className="stat">
            <span className="stat-label">Threshold rule margin</span>
            <strong className="stat-value">{aud(threshold.accounting.margin)}</strong>
            <span className="stat-sub">
              all-day · ends {mwh(threshold.dispatch.intervals.at(-1)!.endingEnergyMWh)} MWh
            </span>
          </div>
        )}
      </div>
      <ul className="result-explain">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <div className="card breakdown">
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
                {threshold && <th scope="col">Threshold rule</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, unit, fixedValue, hindsightValue, thresholdValue]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{unit}</td>
                  <td className="num">{fixedValue}</td>
                  <td className="num">{hindsightValue}</td>
                  {threshold && <td className="num">{thresholdValue}</td>}
                </tr>
              ))}
              <tr className="total">
                <th scope="row">Modelled margin</th>
                <td>AUD</td>
                <td className="num">{aud(fixed.margin)}</td>
                <td className="num">{aud(hindsight.margin)}</td>
                {threshold && <td className="num">{aud(threshold.accounting.margin)}</td>}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="availability">
          Solver bound {aud(result.solver.upperBound)} · absolute gap{" "}
          {aud4(result.solver.absoluteGap)} · limits {result.versions.limits.milliseconds} ms /{" "}
          {result.versions.limits.iterations} iterations
        </p>
      </div>
      <Suspense
        fallback={
          <div className="chart-loading" role="status">
            Loading charts…
          </div>
        }
      >
        <ResultCharts result={result} />
      </Suspense>
      <details className="method">
        <summary>Interval detail · 288 five-minute intervals</summary>
        <p className="availability">
          Exact stored price strings with display-rounded dispatch, stored energy and cumulative
          margin. Power is grid-side: positive imports, negative exports. Interval end labels in NEM
          UTC+10; the final 00:00 is the following day.
        </p>
        <div
          className="price-table"
          tabIndex={0}
          role="region"
          aria-label="Interval dispatch detail (scrollable)"
        >
          <table>
            <caption>288 five-minute intervals · NEM UTC+10</caption>
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
                {threshold && (
                  <>
                    <th scope="col">Threshold MW</th>
                    <th scope="col">Threshold MWh</th>
                    <th scope="col">Threshold margin (AUD)</th>
                  </>
                )}
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
                  {threshold && (
                    <>
                      <td className="num">
                        {signedMw(netMW(threshold.dispatch.intervals[index]!, seconds))}
                      </td>
                      <td className="num">
                        {mwh(threshold.dispatch.intervals[index]!.endingEnergyMWh)}
                      </td>
                      <td className="num">{aud(margins.threshold![index]!)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <details className="method">
        <summary>Methodology and scope</summary>
        <p>
          Each interval updates stored energy as E[t] = E[t−1] + ηc·imported − exported/ηd, with
          exclusive charge/discharge, power and connection limits, and terminal energy equal to the
          initial level.
        </p>
        <p>
          Margin = discharge revenue − charging cost − variable fees − degradation. Importing at a
          negative price earns a credit; conversion losses are physical and never charged twice.
        </p>
        <p>
          Excluded: capital and financing, retail tariffs, network charges and loss factors, and
          ancillary services. This is a simulated trading margin, not investment return.
        </p>
        {threshold && (
          <p>
            The threshold rule is an idealised same-interval replay: each stored interval price
            decides charge/discharge/hold and settles that interval&apos;s energy. It is not a live
            controller or a reconstruction of actual NEM dispatch — publication timing, bidding,
            latency, ramps and dispatch uncertainty are abstracted away, and ending energy may
            differ from the initial level.
          </p>
        )}
        <p>
          <Link to="/methodology">Read the model assumptions</Link>
        </p>
      </details>
    </section>
  );
}
