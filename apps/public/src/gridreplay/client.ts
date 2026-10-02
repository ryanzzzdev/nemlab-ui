import createClient from "openapi-fetch";
import type { paths, components } from "../../../../contracts/generated/schema";

export type Region = components["schemas"]["Region"];
export type EventType = components["schemas"]["GridEventType"];
export type EventSummary = components["schemas"]["GridEventSummary"];
export type EventDetail = components["schemas"]["GridEventDetail"];
export type Publication = components["schemas"]["GridPublication"];
export type EventPage = components["schemas"]["GridEventPage"];

export type ManifestSeries = {
  metric: string;
  // Omitted on the wire when there is no sub-series.
  series?: string | null;
  unit: string;
  grid: "interval_end" | "source_label";
  days: Record<string, string | null>;
};

export type Replay = {
  event: EventDetail;
  manifest: {
    event_id: string;
    window: { start_day: string; end_exclusive: string };
    series: ManifestSeries[];
  };
  payload: Record<string, Record<string, (string | null)[]>>;
};

// The catalogue can change under an open page: a stale pinned cursor raises
// CatalogueChanged, a region without any publication raises NotPublished.
export class NotPublished extends Error {}
export class CatalogueChanged extends Error {}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const day = /^\d{4}-\d{2}-\d{2}$/;
const decimal = /^-?\d+(\.\d+)?$/;
const instant = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const regions: Region[] = ["NSW1", "QLD1", "SA1", "TAS1", "VIC1"];
const types: EventType[] = ["negative_price_run", "price_spike", "demand_ramp"];

function validEvent(event: EventSummary): boolean {
  return (
    uuid.test(event.id) &&
    regions.includes(event.region) &&
    types.includes(event.type) &&
    typeof event.detectorVersion === "string" &&
    day.test(event.marketDay) &&
    instant(event.startAt) &&
    instant(event.endAt) &&
    Date.parse(event.endAt) >= Date.parse(event.startAt) &&
    Number.isInteger(event.intervalCount) &&
    event.intervalCount > 0 &&
    Number.isInteger(event.durationMinutes) &&
    decimal.test(event.value) &&
    typeof event.edgeIncomplete === "boolean" &&
    Number.isInteger(event.version) &&
    event.version >= 1 &&
    typeof event.superseded === "boolean" &&
    typeof event.coverage === "object" &&
    event.coverage !== null
  );
}

function validPublication(publication: Publication): boolean {
  return (
    uuid.test(publication.id) &&
    regions.includes(publication.region) &&
    day.test(publication.startDay) &&
    day.test(publication.endExclusive) &&
    publication.endExclusive > publication.startDay &&
    typeof publication.detectorVersion === "string" &&
    Number.isInteger(publication.eventCount) &&
    publication.eventCount >= 0 &&
    typeof publication.coverage === "object" &&
    publication.coverage !== null &&
    instant(publication.createdAt)
  );
}

function validReplay(replay: Replay): boolean {
  if (!replay || typeof replay !== "object") return false;
  const manifest = replay.manifest;
  if (
    !validEvent(replay.event) ||
    !manifest ||
    !uuid.test(manifest.event_id) ||
    manifest.event_id !== replay.event.id ||
    !day.test(manifest.window?.start_day) ||
    !day.test(manifest.window?.end_exclusive) ||
    !Array.isArray(manifest.series) ||
    typeof replay.payload !== "object" ||
    replay.payload === null
  ) {
    return false;
  }
  return manifest.series.every((series) => {
    if (
      typeof series.metric !== "string" ||
      // The wire format omits `series` entirely when there is no sub-series.
      !(series.series == null || typeof series.series === "string") ||
      typeof series.unit !== "string" ||
      !["interval_end", "source_label"].includes(series.grid) ||
      typeof series.days !== "object" ||
      series.days === null
    ) {
      return false;
    }
    const key = series.series ? `${series.metric}:${series.series}` : series.metric;
    const stored = replay.payload[key];
    return Object.entries(series.days).every(
      ([d, revision]) =>
        day.test(d) &&
        (revision === null || (typeof revision === "string" && uuid.test(revision))) &&
        (revision === null ||
          (Array.isArray(stored?.[d]) &&
            stored[d]!.length === 288 &&
            stored[d]!.every((v) => v === null || decimal.test(v)))),
    );
  });
}

type PublicPaths = Pick<paths, "/api/v1/events" | "/api/v1/events/{id}/replay">;

const client = createClient<PublicPaths>({
  baseUrl: window.location.origin,
  fetch: async (request) => {
    const url = new URL(request.url);
    const replayPath = /^\/api\/v1\/events\/[0-9a-f-]{36}\/replay$/;
    if (
      url.origin !== window.location.origin ||
      request.method !== "GET" ||
      !(url.pathname === "/api/v1/events" || replayPath.test(url.pathname))
    ) {
      throw new Error("This request is not a public GridReplay read.");
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
      throw new Error(
        "Could not reach the GridReplay service. Check your connection and try again.",
      );
    }
    if (!response.ok) {
      const error = await response
        .clone()
        .json()
        .catch(() => null);
      if (response.status === 404 && error?.code === "CATALOGUE_NOT_PUBLISHED") {
        throw new NotPublished("No published GridReplay catalogue covers this region yet.");
      }
      if (response.status === 404 && error?.code === "PUBLICATION_NOT_FOUND") {
        throw new CatalogueChanged(
          "The catalogue was republished while this page was open. Reload the list.",
        );
      }
      if (response.status === 404 && error?.code === "EVENT_NOT_FOUND") {
        throw new Error("This event is no longer in the published catalogue.");
      }
      if (response.status === 400) throw new Error("The GridReplay service rejected this request.");
      if (response.status === 503)
        throw new Error("GridReplay storage is temporarily unavailable. Try again later.");
      throw new Error(`GridReplay service unavailable (HTTP ${response.status}). Try again later.`);
    }
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error("The GridReplay service returned an unexpected response. Try again later.");
    }
    return response;
  },
});

export async function listEvents(
  options: {
    region: Region;
    type?: EventType;
    from?: string;
    to?: string;
    cursor?: string;
    limit?: number;
  },
  signal: AbortSignal,
): Promise<EventPage> {
  try {
    const { data } = await client.GET("/api/v1/events", {
      params: {
        query: {
          region: options.region,
          ...(options.type ? { type: options.type } : {}),
          ...(options.from && options.to ? { from: options.from, to: options.to } : {}),
          ...(options.cursor ? { cursor: options.cursor } : {}),
          ...(options.limit ? { limit: options.limit } : {}),
        },
      },
      signal,
    });

    if (
      !data ||
      !validPublication(data.publication) ||
      data.publication.region !== options.region ||
      !Array.isArray(data.events) ||
      !data.events.every(validEvent) ||
      !(data.nextCursor === null || typeof data.nextCursor === "string")
    ) {
      throw new Error("The GridReplay service returned an invalid catalogue page.");
    }
    return data;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new Error("The GridReplay service returned an unreadable response. Try again later.");
    }
    throw error;
  }
}

export async function readReplay(id: string, signal: AbortSignal): Promise<Replay> {
  try {
    const { data } = await client.GET("/api/v1/events/{id}/replay", {
      params: { path: { id } },
      signal,
    });
    if (!data || !validReplay(data as unknown as Replay)) {
      throw new Error("The GridReplay service returned an invalid replay.");
    }
    return data as unknown as Replay;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new Error("The GridReplay service returned an unreadable response. Try again later.");
    }
    throw error;
  }
}
