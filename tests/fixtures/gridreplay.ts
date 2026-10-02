// Synthetic GridReplay catalogue fixtures. Values are invented test data, not
// real market observations; every event/replay pair is internally consistent
// for the 2023-09-04 NSW1 market day.
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
  },
];

export function eventPage(items = events) {
  return { publication, events: items, nextCursor: null };
}

const manifestSeries = [
  { metric: "price", series: null, unit: "AUD/MWh", grid: "interval_end", days: seriesDays },
  { metric: "demand", series: null, unit: "MW", grid: "source_label", days: seriesDays },
  { metric: "flow_imports", series: null, unit: "MW", grid: "source_label", days: seriesDays },
  { metric: "flow_exports", series: null, unit: "MW", grid: "source_label", days: seriesDays },
  { metric: "power", series: "wind", unit: "MW", grid: "source_label", days: seriesDays },
  { metric: "power", series: "coal_black", unit: "MW", grid: "source_label", days: seriesDays },
];

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
