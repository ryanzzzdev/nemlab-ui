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
