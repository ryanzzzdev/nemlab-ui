import createClient from "openapi-fetch";
import type { paths, components } from "../../../../contracts/generated/schema";

export type Region = components["schemas"]["Region"];
export type Series = components["schemas"]["Series"];
type DayCoverage = components["schemas"]["DayCoverage"];

function validCoverage(value: DayCoverage | undefined, day: string): boolean {
  if (!value || value.day !== day) return false;
  if (value.availability === "NOT_IMPORTED") {
    return (
      value.revision === null &&
      value.retrievedAt === null &&
      value.valid === null &&
      value.missing === null &&
      value.sourceNull === null
    );
  }
  return (
    ["COMPLETE", "INCOMPLETE"].includes(value.availability) &&
    typeof value.revision === "string" &&
    typeof value.retrievedAt === "string" &&
    Number.isFinite(Date.parse(value.retrievedAt)) &&
    [value.valid, value.missing, value.sourceNull].every(
      (count) => Number.isInteger(count) && count! >= 0,
    ) &&
    value.valid! + value.missing! + value.sourceNull! === 288
  );
}

type PublicPaths = Pick<
  paths,
  "/api/v1/prices/{region}/coverage" | "/api/v1/prices/{region}/{day}"
>;

const client = createClient<PublicPaths>({
  baseUrl: window.location.origin,
  fetch: async (request) => {
    const url = new URL(request.url);
    if (
      url.origin !== window.location.origin ||
      request.method !== "GET" ||
      !/^\/api\/v1\/prices\/(NSW1|QLD1|SA1|TAS1|VIC1)\/(coverage|\d{4}-\d{2}-\d{2})$/.test(
        url.pathname,
      )
    ) {
      throw new Error("This request is not a public price read.");
    }
    const headers = new Headers({ Accept: "application/json" });
    let response: Response;
    try {
      response = await fetch(
        new Request(request, {
          headers,
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
        }),
      );
    } catch {
      throw new Error("Could not reach the price service. Check your connection and try again.");
    }
    if (!response.ok) {
      const error = await response
        .clone()
        .json()
        .catch(() => null);
      if (response.status === 404 && error?.code === "PRICE_DAY_NOT_IMPORTED") {
        throw new Error("This day is no longer available. Check coverage again.");
      }
      if (response.status === 400)
        throw new Error("The price service rejected this region or day.");
      if (response.status === 503)
        throw new Error("Price storage is temporarily unavailable. Try again later.");
      throw new Error(`Price service unavailable (HTTP ${response.status}). Try again later.`);
    }
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error("The price service returned an unexpected response. Try again later.");
    }
    return response;
  },
});

export function marketDay(now = new Date()): string {
  return new Date(now.getTime() + 10 * 3600000).toISOString().slice(0, 10);
}

export function nextDay(day: string, offset = 1): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
}

export function validDay(day: string): boolean {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === day &&
    day >= "2021-10-01" &&
    day < marketDay()
  );
}

export async function readPriceDay(region: Region, day: string, signal: AbortSignal) {
  try {
    const { data: coverage } = await client.GET("/api/v1/prices/{region}/coverage", {
      params: { path: { region }, query: { start: day, endExclusive: nextDay(day) } },
      signal,
    });
    const stored = coverage?.days[0];
    if (!stored || !validCoverage(stored, day) || coverage?.region !== region) {
      throw new Error("The price service returned invalid coverage.");
    }
    if (stored.availability === "NOT_IMPORTED") return { coverage: stored, series: null };
    const { data: series } = await client.GET("/api/v1/prices/{region}/{day}", {
      params: { path: { region, day } },
      signal,
    });
    if (
      !series ||
      series.day !== day ||
      series.region !== region ||
      !validCoverage(series.coverage, day) ||
      !Array.isArray(series.intervals) ||
      series.intervals.length !== 288 ||
      !series.intervals.every(
        (slot) =>
          Number.isFinite(Date.parse(slot.start)) &&
          Number.isFinite(Date.parse(slot.end)) &&
          (slot.state === "VALUE"
            ? typeof slot.price === "string" && /^-?[0-9]+(?:\.[0-9]+)?$/.test(slot.price)
            : ["MISSING", "SOURCE_NULL"].includes(slot.state) && slot.price === null),
      )
    ) {
      throw new Error("The price service returned an invalid day series.");
    }
    // A correction between requests may advance the revision. Display the series' own metadata.
    return { coverage: series.coverage, series };
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new Error("The price service returned an unreadable response. Try again later.");
    }
    throw error;
  }
}
