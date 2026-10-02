import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { CatalogueChanged, listEvents, NotPublished, readReplay } from "./client";
import type { EventSummary, EventType, Region, Replay } from "./client";

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
};
const badgeClass: Record<EventType, string> = {
  negative_price_run: "badge-neg",
  price_spike: "badge-spike",
  demand_ramp: "badge-ramp",
};

export const marketTime = (instant: string) =>
  new Date(Date.parse(instant) + 10 * 3600000).toISOString().slice(11, 16);

export function eventTitle(event: Pick<EventSummary, "type" | "value" | "intervalCount">): string {
  const value = Number(event.value);
  if (event.type === "negative_price_run") {
    return `Negative prices for ${event.intervalCount * 5} minutes (low ${value.toFixed(2)})`;
  }
  if (event.type === "price_spike") {
    return `Price spike to ${value.toFixed(2)} AUD/MWh`;
  }
  return `Demand rose ${value.toFixed(0)} MW in three hours`;
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

function EventCard({
  event,
  selected,
  onOpen,
}: {
  event: EventSummary;
  selected: boolean;
  onOpen: (id: string) => void;
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
      <span className="event-meta">
        {event.region} · {event.marketDay} · {marketTime(event.startAt)}–{marketTime(event.endAt)}{" "}
        NEM
      </span>
      <span className="event-stat">
        {event.intervalCount} interval{event.intervalCount === 1 ? "" : "s"} ·{" "}
        {event.durationMinutes} min
      </span>
      <span className="event-foot">
        <span className="event-coverage">
          {event.detectorVersion} · {coverageTag(event)}
        </span>
        {event.version > 1 && <span className="event-version">v{event.version}</span>}
      </span>
    </button>
  );
}

export function GridReplayWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters and the open event live in the URL: shared views are reloadable
  // and Back/Forward restores them. Invalid values fall back to defaults.
  const filters = useMemo<{
    region: Region;
    type: EventType | "";
    from: string;
    to: string;
    event: string | null;
  }>(() => {
    const regionParam = searchParams.get("region");
    const typeParam = searchParams.get("type");
    const fromParam = searchParams.get("from") ?? "";
    const toParam = searchParams.get("to") ?? "";
    const eventParam = searchParams.get("event");
    const dayParam = /^\d{4}-\d{2}-\d{2}$/;
    return {
      region: regions.includes(regionParam as Region) ? (regionParam as Region) : "NSW1",
      type: (Object.keys(typeLabels) as EventType[]).includes(typeParam as EventType)
        ? (typeParam as EventType)
        : "",
      from: dayParam.test(fromParam) ? fromParam : "",
      to: dayParam.test(toParam) ? toParam : "",
      event: eventParam && /^[0-9a-f-]{36}$/.test(eventParam) ? eventParam : null,
    };
  }, [searchParams]);

  // Form inputs are draft copies of the applied (URL) filters.
  const [region, setRegion] = useState<Region>(filters.region);
  const [type, setType] = useState<EventType | "">(filters.type);
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  useEffect(() => {
    setRegion(filters.region);
    setType(filters.type);
    setFrom(filters.from);
    setTo(filters.to);
  }, [filters.region, filters.type, filters.from, filters.to]);

  const linkedEvent = filters.event;
  const replayRef = useRef<HTMLElement>(null);

  const catalogueQuery = useInfiniteQuery({
    queryKey: ["grid-events", filters.region, filters.type, filters.from, filters.to],
    queryFn: ({ pageParam, signal }) =>
      listEvents(
        {
          region: filters.region,
          ...(filters.type ? { type: filters.type } : {}),
          ...(filters.from && filters.to ? { from: filters.from, to: filters.to } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        signal,
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: true,
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
  const publication = catalogueQuery.data?.pages[0]?.publication;

  // Opening an event scrolls the replay into view once it renders.
  useEffect(() => {
    if (linkedEvent && replayQuery.data) {
      replayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [linkedEvent, replayQuery.data]);

  function applyFilters() {
    const params: Record<string, string> = {};
    if (region !== "NSW1") params.region = region;
    if (type) params.type = type;
    if (from && to && from <= to) {
      params.from = from;
      params.to = to;
    }
    setSearchParams(params);
  }

  function openEvent(id: string) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set("event", id);
      else next.delete("event");
      return next;
    });
  }

  const notPublished = catalogueQuery.error instanceof NotPublished;
  const changed = catalogueQuery.error instanceof CatalogueChanged;

  return (
    <>
      <section className="replay-catalogue" aria-labelledby="catalogue-heading">
        <div className="section-heading">
          <h2 id="catalogue-heading">Event catalogue</h2>
          {publication && (
            <span className="availability">
              {publication.region} · {publication.startDay} to {publication.endExclusive} ·{" "}
              {publication.eventCount} events
            </span>
          )}
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
            <select value={type} onChange={(e) => setType(e.target.value as EventType | "")}>
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
          <button type="submit" className="primary">
            Update list
          </button>
        </form>
        {catalogueQuery.isFetching && events.length === 0 && (
          <p role="status">Loading the event catalogue…</p>
        )}
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
            <p>{catalogueQuery.error!.message}</p>
            <button onClick={() => void catalogueQuery.refetch()}>Reload catalogue</button>
          </div>
        )}
        {catalogueQuery.isError && !notPublished && !changed && (
          <div role="alert">
            <p>{catalogueQuery.error!.message}</p>
            <button onClick={() => void catalogueQuery.refetch()}>Try again</button>
          </div>
        )}
        {!catalogueQuery.isError && !catalogueQuery.isFetching && (
          <>
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
        </p>
        <Link to="/methodology">Read about data and limitations</Link>
      </section>
    </>
  );
}
