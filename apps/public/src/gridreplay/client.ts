import createClient from "openapi-fetch";
import type { paths, components } from "../../../../contracts/generated/schema";

export type Region = components["schemas"]["Region"];
export type EventType = components["schemas"]["GridEventType"];
export type EventSummary = components["schemas"]["GridEventSummary"];
export type EventDetail = components["schemas"]["GridEventDetail"];
export type Publication = components["schemas"]["GridPublication"];
export type EventPage = components["schemas"]["GridEventPage"];
export type Highlights = components["schemas"]["GridHighlights"];
export type Highlight = components["schemas"]["GridHighlight"];
export type HighlightReason = components["schemas"]["GridHighlightReason"];
export type Preview = components["schemas"]["GridEventPreview"];
export type Sort = "newest" | "oldest" | "longest" | "deepest" | "highest" | "largest_rise";

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
const types: EventType[] = [
  "negative_price_run",
  "price_spike",
  "demand_ramp",
  "unusual_demand_ramp",
  "price_reversal",
  "negative_price_episode",
];
const reasons = new Set<HighlightReason["code"]>([
  "highest_price",
  "longest_negative_run",
  "deepest_negative_price",
  "largest_demand_rise",
  "unusual_demand_rise",
  "largest_price_reversal",
  "widest_negative_episode",
]);

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
    event.coverage !== null &&
    (event.detail === null || (typeof event.detail === "object" && !Array.isArray(event.detail)))
  );
}

function validHighlight(highlight: Highlight): boolean {
  return (
    validEvent(highlight) &&
    reasons.has(highlight.selectedBy) &&
    Array.isArray(highlight.reasons) &&
    highlight.reasons.every(
      (reason) =>
        reasons.has(reason.code) &&
        Number.isInteger(reason.rank) &&
        reason.rank >= 1 &&
        Number.isInteger(reason.population) &&
        reason.population >= 0,
    )
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

type PublicPaths = Pick<
  paths,
  | "/api/v1/events"
  | "/api/v1/events/highlights"
  | "/api/v1/events/{id}/preview"
  | "/api/v1/events/{id}/replay"
>;

const client = createClient<PublicPaths>({
  baseUrl: window.location.origin,
  fetch: async (request) => {
    const url = new URL(request.url);
    const eventPath = /^\/api\/v1\/events\/[0-9a-f-]{36}\/(preview|replay)$/;
    if (
      url.origin !== window.location.origin ||
      request.method !== "GET" ||
      !(
        url.pathname === "/api/v1/events" ||
        url.pathname === "/api/v1/events/highlights" ||
        eventPath.test(url.pathname)
      )
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

// The query scope shared by the event list and the highlights selection:
// both endpoints normalise the same filters and answer within one pinned
// publication.
export type EventScope = {
  region: Region;
  type?: EventType;
  from?: string;
  to?: string;
  sort?: Sort;
  minDurationMinutes?: number;
  valueGte?: string;
  valueLte?: string;
  publication?: string;
};

function scopeQuery(scope: EventScope) {
  return {
    region: scope.region,
    ...(scope.type ? { type: scope.type } : {}),
    ...(scope.from && scope.to ? { from: scope.from, to: scope.to } : {}),
    ...(scope.sort && scope.sort !== "newest" ? { sort: scope.sort } : {}),
    ...(scope.minDurationMinutes !== undefined
      ? { minDurationMinutes: scope.minDurationMinutes }
      : {}),
    ...(scope.valueGte ? { valueGte: scope.valueGte } : {}),
    ...(scope.valueLte ? { valueLte: scope.valueLte } : {}),
    ...(scope.publication ? { publication: scope.publication } : {}),
  };
}

function validTotals(totals: Record<string, number>): boolean {
  return (
    typeof totals === "object" &&
    totals !== null &&
    Object.entries(totals).every(
      ([type, count]) => types.includes(type as EventType) && Number.isInteger(count) && count >= 0,
    )
  );
}

export async function listEvents(
  scope: EventScope & { cursor?: string; limit?: number },
  signal: AbortSignal,
): Promise<EventPage> {
  try {
    const { data } = await client.GET("/api/v1/events", {
      params: {
        query: {
          ...scopeQuery(scope),
          ...(scope.cursor ? { cursor: scope.cursor } : {}),
          ...(scope.limit ? { limit: scope.limit } : {}),
        },
      },
      signal,
    });

    if (
      !data ||
      !validPublication(data.publication) ||
      data.publication.region !== scope.region ||
      !Array.isArray(data.events) ||
      !data.events.every(validEvent) ||
      !(data.nextCursor === null || typeof data.nextCursor === "string") ||
      !Number.isInteger(data.matchingTotal) ||
      !validTotals(data.typeTotals)
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

export async function listHighlights(scope: EventScope, signal: AbortSignal): Promise<Highlights> {
  try {
    const { data } = await client.GET("/api/v1/events/highlights", {
      params: { query: scopeQuery(scope) },
      signal,
    });
    if (
      !data ||
      !validPublication(data.publication) ||
      data.publication.region !== scope.region ||
      !["highlights-v1", "highlights-v2"].includes(data.selectionVersion) ||
      !Number.isInteger(data.matchingTotal) ||
      !validTotals(data.typeTotals) ||
      !Number.isInteger(data.eligibleCount) ||
      !Number.isInteger(data.excludedCount) ||
      !Array.isArray(data.highlights) ||
      !data.highlights.every(validHighlight)
    ) {
      throw new Error("The GridReplay service returned an invalid highlights selection.");
    }
    return data;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new Error("The GridReplay service returned an unreadable response. Try again later.");
    }
    throw error;
  }
}

function validPreview(preview: Preview): boolean {
  return (
    preview !== null &&
    typeof preview === "object" &&
    preview.version === "preview-v1" &&
    ["price", "demand"].includes(preview.metric) &&
    ["AUD/MWh", "MW"].includes(preview.unit) &&
    preview.intervalMinutes === 5 &&
    instant(preview.startAt) &&
    instant(preview.endAt) &&
    Date.parse(preview.endAt) > Date.parse(preview.startAt) &&
    Number.isInteger(preview.sourcePoints) &&
    preview.sourcePoints >= 0 &&
    Array.isArray(preview.slots) &&
    preview.slots.length >= 1 &&
    preview.slots.length <= 96 &&
    preview.slots.every(
      (slot) =>
        (slot.min === null || decimal.test(slot.min)) &&
        (slot.max === null || decimal.test(slot.max)) &&
        typeof slot.gap === "boolean",
    ) &&
    Array.isArray(preview.eventRanges) &&
    preview.eventRanges.every(
      (range) =>
        Number.isInteger(range.startSlot) &&
        Number.isInteger(range.endSlot) &&
        range.startSlot >= 0 &&
        range.endSlot < preview.slots.length &&
        range.endSlot >= range.startSlot,
    ) &&
    typeof preview.markers === "object" &&
    preview.markers !== null &&
    preview.localScale === true
  );
}

export async function readPreview(id: string, signal: AbortSignal): Promise<Preview> {
  try {
    const { data } = await client.GET("/api/v1/events/{id}/preview", {
      params: { path: { id } },
      signal,
    });
    if (!data || !validPreview(data)) {
      throw new Error("The GridReplay service returned an invalid event preview.");
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
