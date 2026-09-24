import type { components } from "../../contracts/generated/schema";
import { day, revision, series } from "./prices";
export const id = "11111111-1111-4111-8111-111111111111";
export function job(status: components["schemas"]["SimulationStatus"]["status"]) {
  return {
    id,
    status,
    attempts: status === "QUEUED" ? 0 : 1,
    failureCode: status === "FAILED" ? "SIMULATION_DEADLINE_EXCEEDED" : null,
    statusUrl: `/api/v1/simulations/${id}`,
    resultUrl: `/api/v1/simulations/${id}/result`,
  };
}
export function result(): components["schemas"]["SimulationResult"] {
  const strategy: components["schemas"]["SimulationStrategy"] = {
    dispatch: {
      intervals: Array.from({ length: 288 }, () => ({
        importedMWh: 0,
        exportedMWh: 0,
        endingEnergyMWh: 0,
      })),
      limitingReason: "NOT_EVALUATED",
    },
    accounting: {
      importedMWh: 0,
      exportedMWh: 0,
      chargingCost: 0,
      revenue: 0,
      fees: 0,
      degradation: 0,
      margin: 0,
      lossesMWh: 0,
    },
  };
  return {
    id,
    inputs: {
      region: "NSW1",
      day,
      site: {
        capacityMWh: "2",
        minimumMWh: "0",
        maximumMWh: "2",
        initialMWh: "0",
        chargeMW: "1",
        dischargeMW: "1",
        importLimitMW: "1",
        exportLimitMW: "1",
      },
      efficiency: { charge: "0.95", discharge: "0.95" },
      costs: { importFee: "0", exportFee: "0", degradationPerExportedMWh: "0" },
      windows: { chargeStart: 600, chargeEnd: 840, dischargeStart: 1020, dischargeEnd: 1260 },
    },
    priceRevision: revision,
    versions: {
      request: "v1",
      model: "v1",
      fixed: "v1",
      hindsight: "v1",
      solver: "v1",
      executionProfile: "v1",
      limits: { milliseconds: 15000, iterations: 1000 },
    },
    marketOffset: "+10:00",
    intervalSeconds: 300,
    intervalLabel: "END",
    units: { energy: "MWh", power: "MW", money: "AUD", price: "AUD/MWh" },
    prices: series("COMPLETE").intervals.map((v) => ({
      start: v.start,
      end: v.end,
      price: v.price!,
    })),
    fixed: strategy,
    hindsight: strategy,
    solver: { status: "OPTIMAL", objective: 0, upperBound: 0, absoluteGap: 0 },
  };
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

// A scenario where the strategies genuinely differ: negative prices late in the
// charge window (160–163) and high prices late in the discharge window (240–247)
// sit after the fixed policy's earliest-first fill, so only hindsight uses them.
// Nonzero fees/degradation exercise the full breakdown. Dispatch and accounting
// follow the same formulas as the engine so totals reconcile by construction.
export function traded(): components["schemas"]["SimulationResult"] {
  const base = result();
  const eta = 0.95;
  const cap = 1 / 12; // grid MWh per interval at the 1 MW site/connection limits
  const prices = base.prices.map((slot, i) => ({
    ...slot,
    price:
      i === 0
        ? "123.4567890123456789"
        : i >= 160 && i <= 163
          ? "-10"
          : i >= 240 && i <= 247
            ? "80"
            : "0",
  }));
  const fill = (order: number[], total: number) => {
    const values = new Array<number>(288).fill(0);
    let remaining = total;
    for (const i of order) {
      values[i] = Math.min(cap, remaining);
      remaining -= values[i]!;
      if (remaining <= 1e-12) break;
    }
    return values;
  };
  const dispatch = (imports: number[], sold: number[]) => {
    let energy = 0;
    return imports.map((c, i) => {
      energy += eta * c - sold[i]! / eta;
      return { importedMWh: c, exportedMWh: sold[i]!, endingEnergyMWh: energy };
    });
  };
  const accounting = (intervals: { importedMWh: number; exportedMWh: number }[]) => {
    const sum = (f: (v: (typeof intervals)[number], i: number) => number) =>
      intervals.reduce((total, v, i) => total + f(v, i), 0);
    const imported = sum((v) => v.importedMWh);
    const exported = sum((v) => v.exportedMWh);
    const chargingCost = sum((v, i) => Number(prices[i]!.price) * v.importedMWh);
    const revenue = sum((v, i) => Number(prices[i]!.price) * v.exportedMWh);
    const fees = 0.5 * imported + 0.5 * exported;
    const degradation = 0.2 * exported;
    return {
      importedMWh: imported,
      exportedMWh: exported,
      chargingCost,
      revenue,
      fees,
      degradation,
      margin: revenue - chargingCost - fees - degradation,
      lossesMWh: (1 - eta) * imported + (1 / eta - 1) * exported,
    };
  };
  const fixedIntervals = dispatch(fill(range(120, 168), 2 / eta), fill(range(204, 252), 2 * eta));
  const hindsightIntervals = dispatch(
    fill([...range(160, 164), ...range(120, 160)], 2 / eta),
    fill([...range(240, 248), ...range(204, 240)], 2 * eta),
  );
  const hindsightAccounting = accounting(hindsightIntervals);
  return {
    ...base,
    inputs: {
      ...base.inputs,
      costs: { importFee: "0.5", exportFee: "0.5", degradationPerExportedMWh: "0.2" },
    },
    prices,
    fixed: {
      dispatch: { intervals: fixedIntervals, limitingReason: "ENERGY_HEADROOM" },
      accounting: accounting(fixedIntervals),
    },
    hindsight: {
      dispatch: { intervals: hindsightIntervals, limitingReason: "NOT_EVALUATED" },
      accounting: hindsightAccounting,
    },
    solver: {
      status: "OPTIMAL",
      objective: hindsightAccounting.margin,
      upperBound: hindsightAccounting.margin + 0.004,
      absoluteGap: 0.004,
    },
  };
}
