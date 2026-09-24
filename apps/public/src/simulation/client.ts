import type { components } from "../../../../contracts/generated/schema";
import type { Request } from "./scenario";
import { siteFields, costFields, windowFields } from "./scenario";
import { validDay } from "../prices/client";

export type Job = components["schemas"]["SimulationStatus"];
export type Result = components["schemas"]["SimulationResult"];
export const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export class SimulationError extends Error {
  constructor(
    message: string,
    public field = "",
    public reason = "",
    public code = "",
    public retryAfter = 0,
  ) {
    super(message);
  }
}
const messages: Record<string, string> = {
  INVALID_REQUEST:
    "The simulation service rejected an input. Check the highlighted field and try again.",
  PRICE_REFRESH_PENDING: "Stored prices for this day are being fetched.",
  PRICE_REFRESH_FAILED:
    "Stored prices could not be fetched for this day. Try again later or choose another day.",
  VISITOR_REFRESH_LIMIT: "Too many price fetches are pending.",
  SIMULATION_NOT_FOUND: "This simulation could not be found. You can submit the scenario again.",
  RESULT_NOT_READY: "The result is not ready yet. Resume checking this simulation.",
  SIMULATION_FAILED: "The simulation failed. No proven comparison is available.",
  QUEUE_FULL: "The simulation queue is full. Wait before submitting again.",
  STORAGE_UNAVAILABLE: "Simulation storage is temporarily unavailable. Try again later.",
};
async function request(path: string, signal: AbortSignal, body?: Request) {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body ? "POST" : "GET",
      ...(body ? { body: JSON.stringify(body) } : {}),
      headers: body
        ? { Accept: "application/json", "Content-Type": "application/json" }
        : { Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
  } catch {
    if (signal.aborted) throw signal.reason;
    throw new SimulationError(
      body
        ? "Submission could not be confirmed. Retrying the same scenario reuses its job if it was accepted."
        : "Could not reach the simulation service. Resume checking when your connection is available.",
    );
  }
  const value = response.headers.get("content-type")?.includes("application/json")
    ? await response.json().catch(() => null)
    : null;
  const retryAfter = Math.min(120, Math.max(1, Number(response.headers.get("retry-after")) || 2));
  const code = typeof value?.code === "string" ? value.code : "";
  if (!response.ok)
    throw new SimulationError(
      (messages[code] ??
        `Simulation service unavailable (HTTP ${response.status}). Try again later.`) +
        (response.status === 429 ? ` Try after ${retryAfter} seconds.` : ""),
      typeof value?.field === "string" ? value.field : "",
      typeof value?.reason === "string" ? value.reason : "",
      code,
      retryAfter,
    );
  if (!value || ![200, 202].includes(response.status))
    throw new SimulationError("The simulation service returned an unreadable response.");
  return { value, retryAfter };
}
function resource(id: string) {
  if (!uuid.test(id)) throw new SimulationError("Invalid simulation identifier.");
  return `/api/v1/simulations/${id}`;
}
function job(value: Job, expectedId?: string): Job {
  if (
    !uuid.test(value.id) ||
    (expectedId && value.id !== expectedId) ||
    !["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"].includes(value.status) ||
    !Number.isInteger(value.attempts) ||
    value.attempts < 0 ||
    !(value.failureCode === null || typeof value.failureCode === "string")
  )
    throw new SimulationError("The simulation service returned an invalid job status.");
  return value;
}
export async function submitSimulation(body: Request, signal: AbortSignal) {
  const { value, retryAfter } = await request("/api/v1/simulations", signal, body);
  return { job: job(value), retryAfter };
}
export async function readStatus(id: string, signal: AbortSignal) {
  const { value, retryAfter } = await request(resource(id), signal);
  return { job: job(value, id), retryAfter };
}
export async function readResult(id: string, signal: AbortSignal): Promise<Result> {
  const { value } = await request(`${resource(id)}/result`, signal);
  const result = value as Result;
  const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  const decimals = (group: object | undefined, keys: readonly string[]) =>
    group &&
    keys.every((key) => {
      const value = (group as Record<string, unknown>)[key];
      return typeof value === "string" && value.length <= 80 && /^\d+(?:\.\d+)?$/.test(value);
    });
  const strategyValid = (strategy: Result["fixed"] | undefined) =>
    strategy &&
    ["ENERGY_HEADROOM", "CHARGE_WINDOW", "DISCHARGE_WINDOW", "NOT_EVALUATED"].includes(
      strategy.dispatch?.limitingReason,
    ) &&
    Array.isArray(strategy.dispatch?.intervals) &&
    strategy.dispatch.intervals.length === 288 &&
    strategy.dispatch.intervals.every(
      (v) => v && [v.importedMWh, v.exportedMWh, v.endingEnergyMWh].every(finite),
    ) &&
    strategy.accounting &&
    [
      "importedMWh",
      "exportedMWh",
      "chargingCost",
      "revenue",
      "fees",
      "degradation",
      "margin",
      "lossesMWh",
    ].every((k) => finite(strategy.accounting[k as keyof typeof strategy.accounting]));
  if (
    result.id !== id ||
    !uuid.test(result.priceRevision) ||
    !result.inputs ||
    !["NSW1", "QLD1", "VIC1", "SA1", "TAS1"].includes(result.inputs.region) ||
    !validDay(result.inputs.day) ||
    !decimals(result.inputs.site, siteFields) ||
    !decimals(result.inputs.costs, costFields) ||
    !decimals(result.inputs.efficiency, ["charge", "discharge"]) ||
    !windowFields.every(
      (key) =>
        Number.isInteger(result.inputs.windows?.[key]) &&
        result.inputs.windows[key] >= 0 &&
        result.inputs.windows[key] <= 1440 &&
        result.inputs.windows[key] % 5 === 0,
    ) ||
    !result.versions ||
    !["request", "model", "fixed", "hindsight", "solver", "executionProfile"].every(
      (key) => typeof result.versions[key as keyof Result["versions"]] === "string",
    ) ||
    !finite(result.versions.limits?.milliseconds) ||
    !finite(result.versions.limits?.iterations) ||
    result.marketOffset !== "+10:00" ||
    result.intervalSeconds !== 300 ||
    result.intervalLabel !== "END" ||
    result.units?.energy !== "MWh" ||
    result.units?.power !== "MW" ||
    result.units?.money !== "AUD" ||
    result.units?.price !== "AUD/MWh" ||
    result.solver?.status !== "OPTIMAL" ||
    !finite(result.solver.upperBound) ||
    !finite(result.solver.absoluteGap) ||
    !(result.solver.objective === null || finite(result.solver.objective)) ||
    !Array.isArray(result.prices) ||
    result.prices.length !== 288 ||
    !result.prices.every(
      (p) =>
        p &&
        typeof p.price === "string" &&
        /^-?\d+(?:\.\d+)?$/.test(p.price) &&
        Number.isFinite(Date.parse(p.start)) &&
        Number.isFinite(Date.parse(p.end)),
    ) ||
    !strategyValid(result.fixed) ||
    !strategyValid(result.hindsight)
  )
    throw new SimulationError(
      "The simulation service returned an invalid result. Resume checking to try again.",
    );
  return result;
}
