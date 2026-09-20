import type { components } from "../../contracts/generated/schema";

type Day = components["schemas"]["DayCoverage"];
export const day = "2023-10-01";
export const revision = "00000000-0000-4000-8000-000000000001";
export function coverage(state: Day["availability"]): Day {
  const imported = state !== "NOT_IMPORTED";
  return {
    day,
    availability: state,
    revision: imported ? revision : null,
    retrievedAt: imported ? "2023-10-02T01:00:00Z" : null,
    valid: imported ? (state === "COMPLETE" ? 288 : 286) : null,
    missing: imported ? (state === "COMPLETE" ? 0 : 1) : null,
    sourceNull: imported ? (state === "COMPLETE" ? 0 : 1) : null,
  };
}
export function series(state: "COMPLETE" | "INCOMPLETE"): components["schemas"]["Series"] {
  return {
    region: "NSW1",
    day,
    source: "Open Electricity",
    unit: "AUD/MWh",
    intervalSeconds: 300,
    intervalLabel: "END",
    marketOffset: "+10:00",
    coverage: coverage(state),
    intervals: Array.from({ length: 288 }, (_, i) => {
      const start = new Date(Date.parse(`${day}T00:00:00+10:00`) + i * 300000);
      const time = { start: start.toISOString(), end: new Date(+start + 300000).toISOString() };
      if (state === "INCOMPLETE" && i === 3) return { ...time, state: "MISSING", price: null };
      if (state === "INCOMPLETE" && i === 4) return { ...time, state: "SOURCE_NULL", price: null };
      return {
        ...time,
        state: "VALUE",
        price: i === 0 ? "123.4567890123456789" : i === 1 ? "-25" : "0",
      };
    }),
  };
}
