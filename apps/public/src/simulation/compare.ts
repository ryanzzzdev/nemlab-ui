import type { Result } from "./client";

type Strategy = Result["fixed"];
type Interval = Strategy["dispatch"]["intervals"][number];

export const aud = (value: number) => `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`;
export const aud4 = (value: number) => `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(4)}`;
export const mwh = (value: number) => value.toFixed(3);
export const signedMw = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(3)}`;

// Grid-side MW for an interval; positive imports (charges), negative exports.
export const netMW = (interval: Interval, seconds: number) =>
  (interval.importedMWh - interval.exportedMWh) / (seconds / 3600);

// Mirrors Accounting.calculate: price*(exported-imported) - importFee*imported
// - exportFee*exported - degradation*exported.
export function intervalMargin(result: Result, interval: Interval, index: number) {
  const costs = result.inputs.costs;
  const price = Number(result.prices[index]!.price);
  return (
    price * (interval.exportedMWh - interval.importedMWh) -
    Number(costs.importFee) * interval.importedMWh -
    Number(costs.exportFee) * interval.exportedMWh -
    Number(costs.degradationPerExportedMWh) * interval.exportedMWh
  );
}

export function cumulativeMargins(result: Result, strategy: Strategy) {
  let total = 0;
  return strategy.dispatch.intervals.map(
    (interval, index) => (total += intervalMargin(result, interval, index)),
  );
}

// Explains the threshold rule's decision at one interval, including a binding
// energy or power limit when the rule wanted to trade but could not fully.
export function thresholdAction(result: Result, index: number) {
  const t = result.threshold;
  if (!t) return "";
  const price = Number(result.prices[index]!.price);
  const chargeBelow = Number(t.thresholds.chargeBelow);
  const dischargeAbove = Number(t.thresholds.dischargeAbove);
  const interval = t.dispatch.intervals[index]!;
  const site = result.inputs.site;
  if (price < chargeBelow) {
    const cap = Math.min(Number(site.chargeMW), Number(site.importLimitMW)) / 12;
    if (interval.importedMWh + 1e-9 >= cap) return "Charge: below threshold (power limit)";
    return interval.importedMWh > 1e-9
      ? "Charge: below threshold (energy limit)"
      : "Hold: already full";
  }
  if (price > dischargeAbove) {
    const cap = Math.min(Number(site.dischargeMW), Number(site.exportLimitMW)) / 12;
    if (interval.exportedMWh + 1e-9 >= cap) return "Discharge: above threshold (power limit)";
    return interval.exportedMWh > 1e-9
      ? "Discharge: above threshold (energy limit)"
      : "Hold: already empty";
  }
  return "Hold: price between thresholds";
}

export const endLabel = (instant: string, index: number) =>
  new Date(Date.parse(instant) + 10 * 3600000).toISOString().slice(11, 16) +
  (index === 287 ? " +1 day" : "");

function describe(name: string, strategy: Strategy, result: Result) {
  const accounting = strategy.accounting;
  let imported = 0,
    exported = 0,
    inQty = 0,
    inSum = 0,
    outQty = 0,
    outSum = 0,
    negative = 0;
  strategy.dispatch.intervals.forEach((interval, index) => {
    const price = Number(result.prices[index]!.price);
    if (interval.importedMWh > 1e-9) {
      imported++;
      inQty += interval.importedMWh;
      inSum += price * interval.importedMWh;
      if (price < 0) negative++;
    }
    if (interval.exportedMWh > 1e-9) {
      exported++;
      outQty += interval.exportedMWh;
      outSum += price * interval.exportedMWh;
    }
  });
  if (!imported && !exported) return `${name} did not trade.`;
  let text =
    `${name} imported ${mwh(accounting.importedMWh)} MWh across ${imported} interval${imported === 1 ? "" : "s"}` +
    ` (avg ${aud(inSum / inQty)}/MWh) and exported ${mwh(accounting.exportedMWh)} MWh across ${exported}` +
    ` interval${exported === 1 ? "" : "s"} (avg ${aud(outSum / outQty)}/MWh).`;
  if (negative)
    text += ` ${negative} charged interval${negative === 1 ? "" : "s"} had negative prices — a credit, not a cost.`;
  return text;
}

export function explain(result: Result) {
  const items = [describe("The fixed schedule", result.fixed, result)];
  const reason = result.fixed.dispatch.limitingReason;
  const site = result.inputs.site;
  if (reason === "ENERGY_HEADROOM")
    items.push(
      `Its trade size was set by stored-energy headroom (maximum minus initial = ${mwh(Number(site.maximumMWh) - Number(site.initialMWh))} MWh).`,
    );
  else if (reason === "CHARGE_WINDOW")
    items.push("Its trade size was set by the charge window and power limits.");
  else if (reason === "DISCHARGE_WINDOW")
    items.push("Its trade size was set by the discharge window and power limits.");
  items.push(describe("Perfect hindsight", result.hindsight, result));
  const fixed = result.fixed.accounting.margin;
  const hindsight = result.hindsight.accounting.margin;
  if (hindsight <= 1e-9 && fixed < -1e-9)
    items.push(
      `The fixed schedule lost ${aud(-fixed)}; hindsight avoided trading and stayed at $0.`,
    );
  else if (Math.abs(hindsight - fixed) <= 1e-9)
    items.push(
      "Hindsight found no better trade than the fixed schedule under identical constraints.",
    );
  else
    items.push(
      `Hindsight earned ${aud(hindsight - fixed)} more than the fixed schedule under identical constraints.`,
    );
  items.push(
    `Independently evaluated dual bound ${aud(result.solver.upperBound)} — gap ${aud4(result.solver.absoluteGap)}, within the $0.01 optimality tolerance.`,
  );
  if (result.threshold) {
    const t = result.threshold;
    items.push(describe("The price-threshold strategy", t, result));
    const ending = t.dispatch.intervals.at(-1)!.endingEnergyMWh;
    const initial = Number(result.inputs.site.initialMWh);
    items.push(
      `It charged below ${t.thresholds.chargeBelow} and discharged above ${t.thresholds.dischargeAbove} AUD/MWh all day, ending at ${mwh(ending)} MWh versus the ${mwh(initial)} MWh start` +
        (Math.abs(ending - initial) > 1e-9 ? " — no forced end-of-day trade." : ".") +
        " Different operating hours and ending energy mean it is not ranked against the fixed/hindsight pair.",
    );
  }
  return items;
}
