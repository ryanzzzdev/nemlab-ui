// Synthetic GridReplay catalogue fixtures. Values are invented test data, not
// real market observations; every event/replay pair is internally consistent
// for the 2023-09-04 NSW1 market day.
import type { Route } from "@playwright/test";
import { expect } from "@playwright/test";

export const publication = {
  id: "3f7a1c2e-9b4d-4e5f-8a6c-1d2e3f4a5b6c",
  region: "NSW1",
  startDay: "2023-09-01",
  endExclusive: "2023-10-01",
  detectorVersion: "gridreplay-v1",
  eventCount: 2,
  coverage: { days_evaluated: 30, days_complete: 30 },
  createdAt: "2023-10-15T04:12:00Z",
};

const day = "2023-09-04";
const slots = (fill: (index: number) => string | null) =>
  Array.from({ length: 288 }, (_, index) => fill(index));

const price = slots((i) => (i >= 100 && i <= 102 ? "-8.5" : i === 200 ? "1500.25" : "42.10"));
const demand = slots(() => "7100.5");
const wind = slots(() => "820.0");
const coal = slots(() => "3050.25");
const imports = slots(() => "180.0");
const exports = slots(() => "60.0");

const rev = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const seriesDays = { [day]: rev(1) };

export const events = [
  {
    id: "aaaaaaaa-1111-4000-8000-000000000001",
    region: "NSW1",
    type: "negative_price_run",
    detectorVersion: "gridreplay-v1",
    marketDay: day,
    startAt: "2023-09-04T08:25:00+10:00",
    endAt: "2023-09-04T08:35:00+10:00",
    intervalCount: 3,
    durationMinutes: 15,
    value: "-8.5",
    edgeIncomplete: false,
    version: 1,
    superseded: false,
    coverage: { evaluated: 288, missing: 0, edge_incomplete: false },
    detail: null,
  },
  {
    id: "aaaaaaaa-1111-4000-8000-000000000002",
    region: "NSW1",
    type: "price_spike",
    detectorVersion: "gridreplay-v1",
    marketDay: day,
    startAt: "2023-09-04T16:45:00+10:00",
    endAt: "2023-09-04T16:45:00+10:00",
    intervalCount: 1,
    durationMinutes: 5,
    value: "1500.25",
    edgeIncomplete: false,
    version: 1,
    superseded: false,
    coverage: { evaluated: 288, missing: 0, edge_incomplete: false },
    detail: null,
  },
];

function typeTotals(items: { type: string }[]) {
  return items.reduce(
    (totals, item) => ({ ...totals, [item.type]: (totals[item.type] ?? 0) + 1 }),
    {} as Record<string, number>,
  );
}

export function eventPage(items = events) {
  return {
    publication,
    events: items,
    nextCursor: null,
    matchingTotal: items.length,
    typeTotals: typeTotals(items),
  };
}

const selectedBy: Record<string, string> = {
  negative_price_run: "longest_negative_run",
  price_spike: "highest_price",
  demand_ramp: "largest_demand_rise",
  unusual_demand_ramp: "unusual_demand_rise",
  price_reversal: "largest_price_reversal",
  negative_price_episode: "widest_negative_episode",
};

export function highlightsPage(items = events) {
  return {
    publication,
    selectionVersion: "highlights-v1",
    scope: {},
    matchingTotal: items.length,
    typeTotals: typeTotals(items),
    eligibleCount: items.length,
    excludedCount: 0,
    highlights: items.map((item) => ({
      ...item,
      selectedBy: selectedBy[item.type] ?? "highest_price",
      reasons: [{ code: selectedBy[item.type] ?? "highest_price", rank: 1, population: 12 }],
    })),
  };
}

export function preview() {
  return {
    version: "preview-v1",
    metric: "price",
    unit: "AUD/MWh",
    intervalMinutes: 5,
    startAt: "2023-09-04T07:25:00+10:00",
    endAt: "2023-09-04T11:25:00+10:00",
    sourcePoints: 288,
    slots: Array.from({ length: 48 }, (_, index) =>
      index === 24 ? { min: null, max: null, gap: true } : { min: "-9.2", max: "45.6", gap: false },
    ),
    eventRanges: [{ startSlot: 20, endSlot: 22 }],
    markers: {},
    localScale: true,
  };
}

const manifestSeries = [
  { metric: "price", series: null, unit: "AUD/MWh", grid: "interval_end", days: seriesDays },
  { metric: "demand", series: null, unit: "MW", grid: "source_label", days: seriesDays },
  { metric: "flow_imports", series: null, unit: "MW", grid: "source_label", days: seriesDays },
  { metric: "flow_exports", series: null, unit: "MW", grid: "source_label", days: seriesDays },
  { metric: "power", series: "wind", unit: "MW", grid: "source_label", days: seriesDays },
  { metric: "power", series: "coal_black", unit: "MW", grid: "source_label", days: seriesDays },
];

// Routes the whole public event API for a test. Every fixture stays a valid
// wire shape: the app validates responses and drops malformed ones.
export async function routeGridReplay(
  route: Route,
  options: {
    page?: (cursor: string | null) => object;
    highlights?: object;
    onList?: (url: URL) => void;
  } = {},
) {
  const request = route.request();
  expect(request.method()).toBe("GET");
  expect(request.headers()["authorization"]).toBeUndefined();
  expect(request.headers()["cookie"]).toBeUndefined();
  const url = new URL(request.url());
  const idPath = url.pathname.match(/^\/api\/v1\/events\/([0-9a-f-]{36})\/(preview|replay)$/);
  if (idPath) {
    await route.fulfill({ json: idPath[2] === "replay" ? replay(idPath[1]!) : preview() });
    return;
  }
  options.onList?.(url);
  if (url.pathname === "/api/v1/events/highlights") {
    await route.fulfill({ json: options.highlights ?? highlightsPage() });
    return;
  }
  await route.fulfill({
    json: options.page ? options.page(url.searchParams.get("cursor")) : eventPage(),
  });
}

export function replay(id: string) {
  const event = events.find((candidate) => candidate.id === id) ?? events[0]!;
  return {
    event: {
      ...event,
      detectorParams:
        event.type === "negative_price_run"
          ? { below: 0, min_intervals: 3 }
          : { above: 1000, min_intervals: 1 },
      sourceRevisions: {
        "price/2023-09-04": rev(1),
        "demand//2023-09-04": rev(1),
        "power/wind/2023-09-04": rev(1),
        "power/coal_black/2023-09-04": rev(1),
        "flow_imports//2023-09-04": rev(1),
        "flow_exports//2023-09-04": rev(1),
      },
      replay: { start_day: day, end_exclusive: "2023-09-05" },
    },
    manifest: {
      event_id: event.id,
      window: { start_day: day, end_exclusive: "2023-09-05" },
      series: manifestSeries,
    },
    payload: {
      price: { [day]: price },
      demand: { [day]: demand },
      flow_imports: { [day]: imports },
      flow_exports: { [day]: exports },
      "power:wind": { [day]: wind },
      "power:coal_black": { [day]: coal },
    },
  };
}
