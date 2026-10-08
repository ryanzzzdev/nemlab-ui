import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  CatalogueChanged,
  listEvents,
  listHighlights,
  NotPublished,
  readPreview,
  readReplay,
} from "./client";
import type {
  EventScope,
  EventSummary,
  EventType,
  Highlight,
  HighlightReason,
  Preview,
  Region,
  Replay,
  Sort,
} from "./client";

const ReplaySection = lazy(() =>
  import("./ReplaySection").catch(() => ({
    default: function UnavailableReplay() {
      return <p role="alert">The replay charts could not load. Reload the page to try again.</p>;
    },
  })),
);

const regions: Region[] = ["NSW1", "QLD1", "SA1", "TAS1", "VIC1"];
const typeLabels: Record<EventType, string> = {
  negative_price_run: "Negative-price run",
  price_spike: "Price spike",
  demand_ramp: "Demand ramp",
  unusual_demand_ramp: "Unusual demand ramp",
  price_reversal: "Price reversal",
  negative_price_episode: "Negative-price episode",
};
const badgeClass: Record<EventType, string> = {
  negative_price_run: "badge-neg",
  price_spike: "badge-spike",
  demand_ramp: "badge-ramp",
  unusual_demand_ramp: "badge-unusual",
  price_reversal: "badge-reversal",
  negative_price_episode: "badge-episode",
};
const reasonLabels: Record<HighlightReason["code"], string> = {
  highest_price: "highest price",
  longest_negative_run: "longest negative run",
  deepest_negative_price: "deepest price",
  largest_demand_rise: "largest demand rise",
  unusual_demand_rise: "unusual demand rise",
  largest_price_reversal: "largest reversal",
  widest_negative_episode: "widest episode",
};

// Catalogue sorts the backend supports for each type; anything else is an
// unsupported combination and would be rejected by the service.
const sortsFor = (type: EventType | ""): { value: Sort; label: string }[] => {
  const newest = { value: "newest" as const, label: "Newest first" };
  if (!type) return [newest, { value: "oldest", label: "Oldest first" }];
  const extra: Record<EventType, { value: Sort; label: string }[]> = {
    negative_price_run: [
      { value: "longest", label: "Longest first" },
      { value: "deepest", label: "Lowest price first" },
    ],
    price_spike: [
      { value: "longest", label: "Longest first" },
      { value: "highest", label: "Highest price first" },
    ],
    demand_ramp: [{ value: "largest_rise", label: "Largest rise first" }],
    unusual_demand_ramp: [{ value: "largest_rise", label: "Largest rise first" }],
    price_reversal: [{ value: "highest", label: "Highest peak first" }],
    negative_price_episode: [
      { value: "longest", label: "Longest first" },
      { value: "deepest", label: "Lowest price first" },
    ],
  };
  return [newest, ...extra[type]];
};

const MIN_DURATION_TYPES = new Set<EventType>([
  "negative_price_run",
  "price_spike",
  "negative_price_episode",
]);
const VALUE_GTE_TYPES = new Set<EventType>([
  "price_spike",
  "price_reversal",
  "demand_ramp",
  "unusual_demand_ramp",
]);
const VALUE_LTE_TYPES = new Set<EventType>(["negative_price_run", "negative_price_episode"]);
const RAMP_TYPES = new Set<EventType>(["demand_ramp", "unusual_demand_ramp"]);

export const marketTime = (instant: string) =>
  new Date(Date.parse(instant) + 10 * 3600000).toISOString().slice(11, 16);

export function eventTitle(
  event: Pick<EventSummary, "type" | "value" | "intervalCount" | "durationMinutes" | "detail">,
): string {
  const value = Number(event.value);
  const detail = (event.detail ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case "negative_price_run":
      return `Negative prices for ${durationText(event.durationMinutes)} (low ${value.toFixed(2)})`;
    case "price_spike":
      return `Price spike to ${value.toFixed(2)} AUD/MWh`;
    case "demand_ramp":
      return `Demand rose ${value.toFixed(0)} MW in three hours`;
    case "unusual_demand_ramp":
      return `Unusual demand rise of ${value.toFixed(0)} MW in three hours`;
    case "price_reversal": {
      const trough = typeof detail.trough === "string" ? Number(detail.trough) : null;
      return trough === null || !Number.isFinite(trough)
        ? `Negative prices reversed to ${value.toFixed(2)} AUD/MWh`
        : `Prices reversed from ${trough.toFixed(2)} to ${value.toFixed(2)} AUD/MWh`;
    }
    case "negative_price_episode": {
      const negative = typeof detail.negativeMinutes === "number" ? detail.negativeMinutes : null;
      return negative === null
        ? `Negative-price episode over ${durationText(event.durationMinutes)}`
        : `Negative-price episode — ${negative} min negative over ${durationText(event.durationMinutes)}`;
    }
  }
}

function coverageTag(event: EventSummary): string {
  const coverage = event.coverage as { evaluated?: number; missing?: number };
  if (typeof coverage.evaluated !== "number" || typeof coverage.missing !== "number") {
    return event.edgeIncomplete ? "edge-incomplete" : "recorded";
  }
  return coverage.missing === 0
    ? `${event.edgeIncomplete ? "edge-incomplete · " : ""}complete coverage`
    : `${event.edgeIncomplete ? "edge-incomplete · " : ""}${coverage.missing} missing`;
}

// Duration is exact minutes; render it readably ("9h 5m", "45 min").
export function durationText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function statLine(event: EventSummary): string {
  const count = RAMP_TYPES.has(event.type)
    ? `${event.intervalCount} observations`
    : `${event.intervalCount} interval${event.intervalCount === 1 ? "" : "s"}`;
  return `${count} · ${durationText(event.durationMinutes)}`;
}

// A bounded sparkline rendered from the immutable preview endpoint — never a
// full replay fetch per card. Slots are min/max bands on a local scale with
// the detected range shaded; gaps stay visible.
function Sparkline({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ["grid-preview", id],
    queryFn: ({ signal }) => readPreview(id, signal),
    retry: false,
    staleTime: Infinity,
    gcTime: 300000,
    refetchOnWindowFocus: false,
  });
  if (!query.data) return <div className="spark spark-empty" aria-hidden="true" />;
  return <Spark preview={query.data} />;
}

function Spark({ preview }: { preview: Preview }) {
  const W = 240;
  const H = 44;
  const PAD = 3;
  const numbers = preview.slots
    .flatMap((slot) => [slot.min, slot.max])
    .filter((value): value is string => value !== null)
    .map(Number);
  if (numbers.length === 0) return <div className="spark spark-empty" aria-hidden="true" />;
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  const span = high - low || 1;
  const x = (index: number) => (index / (preview.slots.length - 1 || 1)) * W;
  const y = (value: number) => H - PAD - ((value - low) / span) * (H - 2 * PAD);
  const bands = preview.slots
    .map((slot, index) => {
      if (slot.min === null || slot.max === null) return null;
      const top = y(Number(slot.max));
      const bottom = y(Number(slot.min));
      return (
        <line
          key={index}
          className={slot.gap ? "spark-band spark-gap" : "spark-band"}
          x1={x(index)}
          x2={x(index)}
          y1={top}
          y2={Math.max(bottom, top + 1)}
        />
      );
    })
    .filter(Boolean);
  const peak = preview.markers["peakSlot"];
  return (
    <svg
      className="spark"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${preview.metric} preview across ${preview.sourcePoints} five-minute intervals`}
    >
      {preview.eventRanges.map((range, index) => (
        <rect
          key={index}
          className="spark-range"
          x={x(range.startSlot)}
          width={Math.max(2, x(range.endSlot) - x(range.startSlot))}
          y={0}
          height={H}
        />
      ))}
      {low < 0 && high > 0 && <line className="spark-zero" x1={0} x2={W} y1={y(0)} y2={y(0)} />}
      {bands}
      {typeof peak === "number" && peak >= 0 && peak < preview.slots.length && (
        <circle className="spark-peak" cx={x(peak)} cy={y(high)} r={2.5} />
      )}
    </svg>
  );
}

function reasonLine(highlight: Highlight): string {
  return highlight.reasons
    .map(
      (reason) => `#${reason.rank} ${reasonLabels[reason.code]} of ${reason.population} eligible`,
    )
    .join(" · ");
}

function EventCard({
  event,
  selected,
  onOpen,
  highlight,
}: {
  event: EventSummary;
  selected: boolean;
  onOpen: (id: string) => void;
  highlight?: Highlight;
}) {
  return (
    <button
      type="button"
      className={`event-card ${selected ? "selected" : ""}`}
      onClick={() => onOpen(event.id)}
      aria-pressed={selected}
    >
      <span className={`event-badge ${badgeClass[event.type]}`}>{typeLabels[event.type]}</span>
      <span className="event-title">{eventTitle(event)}</span>
      <Sparkline id={event.id} />
      <span className="event-meta">
        {event.region} · {event.marketDay} · {marketTime(event.startAt)}–{marketTime(event.endAt)}{" "}
        NEM
      </span>
      <span className="event-stat">{statLine(event)}</span>
      {highlight && <span className="event-reason">{reasonLine(highlight)}</span>}
      <span className="event-foot">
        <span className="event-coverage">
          {event.detectorVersion} · {coverageTag(event)}
        </span>
        {event.version > 1 && <span className="event-version">v{event.version}</span>}
      </span>
    </button>
  );
}

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const idPattern = /^[0-9a-f-]{36}$/;
const decimalPattern = /^-?\d+(\.\d+)?$/;

// Market-day labels are UTC+10 calendar days extended in UTC space.
function inclusiveEnd(endExclusive: string): string {
  const last = new Date(Date.parse(`${endExclusive}T00:00:00Z`) - 86400000);
  return last.toISOString().slice(0, 10);
}

type Filters = {
  view: "highlights" | "all";
  region: Region;
  type: EventType | "";
  from: string;
  to: string;
  sort: Sort;
  minDuration: string;
  valueGte: string;
  valueLte: string;
  event: string | null;
};

function parseFilters(searchParams: URLSearchParams): Filters {
  const regionParam = searchParams.get("region");
  const typeParam = searchParams.get("type");
  const type = (Object.keys(typeLabels) as EventType[]).includes(typeParam as EventType)
    ? (typeParam as EventType)
    : "";
  const sortParam = searchParams.get("sort");
  const sort = sortsFor(type).some((option) => option.value === sortParam)
    ? (sortParam as Sort)
    : "newest";
  const fromParam = searchParams.get("from") ?? "";
  const toParam = searchParams.get("to") ?? "";
  const minDurationParam = searchParams.get("minDuration") ?? "";
  const valueGteParam = searchParams.get("valueGte") ?? "";
  const valueLteParam = searchParams.get("valueLte") ?? "";
  const eventParam = searchParams.get("event");
  return {
    view: searchParams.get("view") === "all" ? "all" : "highlights",
    region: regions.includes(regionParam as Region) ? (regionParam as Region) : "NSW1",
    type,
    from: dayPattern.test(fromParam) ? fromParam : "",
    to: dayPattern.test(toParam) ? toParam : "",
    sort,
    minDuration:
      type && MIN_DURATION_TYPES.has(type) && /^\d+$/.test(minDurationParam)
        ? minDurationParam
        : "",
    valueGte:
      type && VALUE_GTE_TYPES.has(type) && decimalPattern.test(valueGteParam) ? valueGteParam : "",
    valueLte:
      type && VALUE_LTE_TYPES.has(type) && decimalPattern.test(valueLteParam) ? valueLteParam : "",
    event: eventParam && idPattern.test(eventParam) ? eventParam : null,
  };
}

function filtersScope(filters: Filters): EventScope {
  return {
    region: filters.region,
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.from && filters.to ? { from: filters.from, to: filters.to } : {}),
    ...(filters.sort !== "newest" ? { sort: filters.sort } : {}),
    ...(filters.minDuration ? { minDurationMinutes: Number(filters.minDuration) } : {}),
    ...(filters.valueGte ? { valueGte: filters.valueGte } : {}),
    ...(filters.valueLte ? { valueLte: filters.valueLte } : {}),
  };
}

export function GridReplayWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters, the view and the open event live in the URL: shared views are
  // reloadable and Back/Forward restores them. Invalid values fall back.
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const isAll = filters.view === "all";

  // Form inputs are draft copies of the applied (URL) filters.
  const [region, setRegion] = useState<Region>(filters.region);
  const [type, setType] = useState<EventType | "">(filters.type);
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [sort, setSort] = useState<Sort>(filters.sort);
  const [minDuration, setMinDuration] = useState(filters.minDuration);
  const [valueGte, setValueGte] = useState(filters.valueGte);
  const [valueLte, setValueLte] = useState(filters.valueLte);
  useEffect(() => {
    setRegion(filters.region);
    setType(filters.type);
    setFrom(filters.from);
    setTo(filters.to);
    setSort(filters.sort);
    setMinDuration(filters.minDuration);
    setValueGte(filters.valueGte);
    setValueLte(filters.valueLte);
  }, [filters]);

  const linkedEvent = filters.event;
  const replayRef = useRef<HTMLElement>(null);
  const scope = filtersScope(filters);

  const highlightsQuery = useQuery({
    queryKey: ["grid-highlights", scope],
    queryFn: ({ signal }) => listHighlights(scope, signal),
    enabled: !isAll,
    retry: false,
    staleTime: 0,
    gcTime: 300000,
    refetchOnWindowFocus: false,
  });

  const catalogueQuery = useInfiniteQuery({
    queryKey: ["grid-events", scope],
    queryFn: ({ pageParam, signal }) =>
      listEvents({ ...scope, ...(pageParam ? { cursor: pageParam } : {}) }, signal),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: isAll,
    retry: false,
    staleTime: 0,
    gcTime: 300000,
    refetchOnWindowFocus: false,
  });

  const replayQuery = useQuery({
    queryKey: ["grid-replay", linkedEvent],
    queryFn: ({ signal }) => readReplay(linkedEvent!, signal),
    enabled: Boolean(linkedEvent),
    retry: false,
    staleTime: Infinity,
    gcTime: 300000,
    refetchOnWindowFocus: false,
  });

  const events = catalogueQuery.data?.pages.flatMap((page) => page.events) ?? [];
  const highlights = highlightsQuery.data?.highlights ?? [];
  const publication = isAll
    ? catalogueQuery.data?.pages[0]?.publication
    : highlightsQuery.data?.publication;
  const active = isAll ? catalogueQuery : highlightsQuery;

  // Opening an event scrolls the replay into view once it renders.
  useEffect(() => {
    if (linkedEvent && replayQuery.data) {
      replayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [linkedEvent, replayQuery.data]);

  function applyFilters() {
    const params: Record<string, string> = {};
    if (filters.view === "all") params.view = "all";
    if (region !== "NSW1") params.region = region;
    if (type) params.type = type;
    if (from && to && from <= to) {
      params.from = from;
      params.to = to;
    }
    if (sort !== "newest" && sortsFor(type).some((option) => option.value === sort)) {
      params.sort = sort;
    }
    if (type && MIN_DURATION_TYPES.has(type) && /^\d+$/.test(minDuration)) {
      params.minDuration = minDuration;
    }
    if (type && VALUE_GTE_TYPES.has(type) && decimalPattern.test(valueGte)) {
      params.valueGte = valueGte;
    }
    if (type && VALUE_LTE_TYPES.has(type) && decimalPattern.test(valueLte)) {
      params.valueLte = valueLte;
    }
    setSearchParams(params);
  }

  function setView(view: "highlights" | "all") {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (view === "all") next.set("view", "all");
      else next.delete("view");
      if (view === "highlights") {
        next.delete("sort");
        next.delete("minDuration");
        next.delete("valueGte");
        next.delete("valueLte");
      }
      return next;
    });
  }

  function openEvent(id: string) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set("event", id);
      else next.delete("event");
      return next;
    });
  }

  const notPublished = active.error instanceof NotPublished;
  const changed = active.error instanceof CatalogueChanged;
  const draftSorts = sortsFor(type);

  return (
    <>
      <section className="replay-catalogue" aria-labelledby="catalogue-heading">
        <div className="section-heading">
          <h2 id="catalogue-heading">Event catalogue</h2>
          {publication && (
            <span className="availability">
              {publication.region} · {publication.startDay} to{" "}
              {inclusiveEnd(publication.endExclusive)} · {publication.eventCount} events
            </span>
          )}
        </div>
        <div className="seg view-tabs" role="group" aria-label="Catalogue view">
          <button
            type="button"
            className={isAll ? "" : "on"}
            aria-pressed={!isAll}
            onClick={() => setView("highlights")}
          >
            Highlights
          </button>
          <button
            type="button"
            className={isAll ? "on" : ""}
            aria-pressed={isAll}
            onClick={() => setView("all")}
          >
            All events
          </button>
        </div>
        <form
          className="replay-filters"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters();
          }}
        >
          <label>
            Region
            <select value={region} onChange={(e) => setRegion(e.target.value as Region)}>
              {regions.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Event type
            <select
              value={type}
              onChange={(e) => {
                const next = e.target.value as EventType | "";
                setType(next);
                // A sort that the new type cannot support falls back before
                // it can reach the URL or the request.
                if (!sortsFor(next).some((option) => option.value === sort)) {
                  setSort("newest");
                }
              }}
            >
              <option value="">All types</option>
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input
              type="date"
              value={from}
              min={publication?.startDay}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={to}
              min={from || undefined}
              max={publication ? publication.endExclusive : undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          {isAll && (
            <label>
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                {draftSorts.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" className="primary">
            Update list
          </button>
        </form>
        {isAll && type && (
          <details className="replay-more">
            <summary>More filters</summary>
            <div className="replay-filters">
              {MIN_DURATION_TYPES.has(type) && (
                <label>
                  Min duration (min)
                  <input
                    type="number"
                    min={0}
                    step={5}
                    inputMode="numeric"
                    value={minDuration}
                    onChange={(e) => setMinDuration(e.target.value)}
                  />
                </label>
              )}
              {VALUE_GTE_TYPES.has(type) && (
                <label>
                  Value at least
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder={RAMP_TYPES.has(type) ? "MW" : "AUD/MWh"}
                    value={valueGte}
                    onChange={(e) => setValueGte(e.target.value)}
                  />
                </label>
              )}
              {VALUE_LTE_TYPES.has(type) && (
                <label>
                  Value at most
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="AUD/MWh"
                    value={valueLte}
                    onChange={(e) => setValueLte(e.target.value)}
                  />
                </label>
              )}
            </div>
          </details>
        )}
        {active.isFetching &&
          (isAll ? events.length === 0 : highlights.length === 0) &&
          !active.data && <p role="status">Loading the event catalogue…</p>}
        {notPublished && (
          <div className="empty-state">
            <h3>No catalogue published for {region}</h3>
            <p>
              GridReplay catalogues are published per region by an operator after importing grid
              observations. No market events are available for this region yet.
            </p>
          </div>
        )}
        {changed && (
          <div role="alert">
            <p>{active.error!.message}</p>
            <button onClick={() => void active.refetch()}>Reload catalogue</button>
          </div>
        )}
        {active.isError && !notPublished && !changed && (
          <div role="alert">
            <p>{active.error!.message}</p>
            <button onClick={() => void active.refetch()}>Try again</button>
          </div>
        )}
        {!isAll && !highlightsQuery.isError && highlightsQuery.data && (
          <>
            <p className="availability">
              {highlightsQuery.data.highlights.length} highlights selected from{" "}
              {highlightsQuery.data.eligibleCount} eligible of {highlightsQuery.data.matchingTotal}{" "}
              matching events
              {highlightsQuery.data.excludedCount > 0 &&
                ` · ${highlightsQuery.data.excludedCount} excluded for incomplete coverage`}
            </p>
            {highlights.length === 0 ? (
              <div className="empty-state">
                <h3>No highlights in this scope</h3>
                <p>
                  No matching events have complete enough coverage to be selected. Try a wider
                  market-day range or browse all events.
                </p>
              </div>
            ) : (
              <div className="event-cards">
                {highlights.map((highlight) => (
                  <EventCard
                    key={highlight.id}
                    event={highlight}
                    highlight={highlight}
                    selected={highlight.id === linkedEvent}
                    onOpen={openEvent}
                  />
                ))}
              </div>
            )}
          </>
        )}
        {isAll && !catalogueQuery.isError && catalogueQuery.data && (
          <>
            <p className="availability">
              {catalogueQuery.data.pages[0]!.matchingTotal} matching events
            </p>
            {events.length === 0 ? (
              <div className="empty-state">
                <h3>No events match these filters</h3>
                <p>Try a different type or widen the market-day range.</p>
              </div>
            ) : (
              <div className="event-cards">
                {events.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    selected={event.id === linkedEvent}
                    onOpen={openEvent}
                  />
                ))}
              </div>
            )}
            {catalogueQuery.hasNextPage && (
              <button
                type="button"
                className="ghost"
                disabled={catalogueQuery.isFetchingNextPage}
                onClick={() => void catalogueQuery.fetchNextPage()}
              >
                {catalogueQuery.isFetchingNextPage ? "Loading…" : "Show more events"}
              </button>
            )}
          </>
        )}
        {catalogueQuery.isFetchNextPageError && (
          <div role="alert">
            <p>The catalogue was republished or this page could not be read.</p>
            <button onClick={() => void catalogueQuery.refetch()}>Reload catalogue</button>
          </div>
        )}
      </section>
      {linkedEvent && (
        <section className="replay-section" aria-labelledby="replay-heading" ref={replayRef}>
          <div className="section-heading">
            <h2 id="replay-heading">Replay</h2>
            <button type="button" className="ghost" onClick={() => openEvent("")}>
              Close replay
            </button>
          </div>
          {replayQuery.isFetching && <p role="status">Loading replay…</p>}
          {replayQuery.isError && (
            <div role="alert">
              <p>{replayQuery.error.message}</p>
              <button onClick={() => void replayQuery.refetch()}>Try again</button>
            </div>
          )}
          {replayQuery.data && (
            <Suspense
              fallback={
                <div className="chart-loading" role="status">
                  Loading replay…
                </div>
              }
            >
              <ReplaySection replay={replayQuery.data as Replay} />
            </Suspense>
          )}
        </section>
      )}
      <section className="prose" aria-labelledby="grid-method">
        <h2 id="grid-method">How to read a replay</h2>
        <p>
          Every event is detected by fixed rules over stored observations, and each replay reuses
          the exact revisions recorded when the catalogue was published. Gaps in the source data
          stay visible — a missing observation does not mean zero generation or a zero price.
          Highlights are a small ranked selection of the same catalogue; All events keeps every
          detected event.
        </p>
        <Link to="/methodology">Read about data and limitations</Link>
      </section>
    </>
  );
}
