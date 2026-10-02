import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { eventTitle, marketTime } from "./GridReplayWorkspace";
import type { Replay } from "./client";
import ReplayCharts from "./ReplayCharts";

const DAY_MS = 86400000;
const INTERVAL_MS = 300000;
const RENEWABLE = new Set([
  "solar_utility",
  "solar_rooftop",
  "wind",
  "hydro",
  "bioenergy_biomass",
  "bioenergy_biogas",
]);
const SPEEDS = [1, 4, 16, 60];

// Flatten the per-day payload into one interval sequence across the window.
function flatten(replay: Replay) {
  const days: string[] = [];
  const windowStart = Date.parse(`${replay.manifest.window.start_day}T00:00:00+10:00`);
  const endExclusive = replay.manifest.window.end_exclusive;
  for (let offset = 0; ; offset += 1) {
    // Market-day labels are UTC+10 calendar days; extend them in UTC space.
    const day = new Date(
      Date.parse(`${replay.manifest.window.start_day}T00:00:00Z`) + offset * DAY_MS,
    )
      .toISOString()
      .slice(0, 10);
    if (day >= endExclusive) break;
    days.push(day);
  }
  const series = (key: string): (string | null)[] => {
    const byDay = replay.payload[key];
    return days.flatMap((day) => byDay?.[day] ?? Array.from({ length: 288 }, () => null));
  };
  const power: Record<string, (string | null)[]> = {};
  for (const item of replay.manifest.series) {
    if (item.metric === "power" && item.series) {
      power[item.series] = series(`power:${item.series}`);
    }
  }
  return {
    days,
    windowStart,
    count: days.length * 288,
    price: series("price"),
    demand: series("demand"),
    imports: series("flow_imports"),
    exports: series("flow_exports"),
    power,
  };
}

function valueAt(values: (string | null)[], index: number): number | null {
  const value = values[index];
  return value === null || value === undefined ? null : Number(value);
}

// The event start/end instants are interval-end timestamps on the UTC+10 grid.
function eventSpan(replay: Replay, windowStart: number): [number, number] {
  const start = Math.round((Date.parse(replay.event.startAt) - windowStart) / INTERVAL_MS) - 1;
  const end = Math.round((Date.parse(replay.event.endAt) - windowStart) / INTERVAL_MS) - 1;
  return [Math.max(0, start), end];
}

export default function ReplaySection({ replay }: { replay: Replay }) {
  const data = useMemo(() => flatten(replay), [replay]);
  const [spanStart, spanEnd] = useMemo(
    () => eventSpan(replay, data.windowStart),
    [replay, data.windowStart],
  );
  const [cursor, setCursor] = useState(spanStart);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(16);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setCursor((current) => {
        if (current + speed >= data.count - 1) {
          setPlaying(false);
          return data.count - 1;
        }
        return current + speed;
      });
    }, 120);
    return () => clearInterval(timer);
  }, [playing, speed, data.count]);

  const dayIndex = Math.floor(cursor / 288);
  const clock = `${data.days[dayIndex]} · ${marketTime(
    new Date(data.windowStart + (cursor + 1) * INTERVAL_MS).toISOString(),
  )} NEM`;

  const price = valueAt(data.price, cursor);
  const demand = valueAt(data.demand, cursor);
  const imports = valueAt(data.imports, cursor);
  const exports_ = valueAt(data.exports, cursor);
  const netFlow = imports === null && exports_ === null ? null : (imports ?? 0) - (exports_ ?? 0);
  let renewableShare: number | null = null;
  let generation = 0;
  let renewable = 0;
  let anyPower = false;
  for (const [fueltech, values] of Object.entries(data.power)) {
    const value = valueAt(values, cursor);
    if (value === null) continue;
    anyPower = true;
    if (value > 0) {
      generation += value;
      if (RENEWABLE.has(fueltech)) renewable += value;
    }
  }
  if (anyPower && generation > 0) renewableShare = (renewable / generation) * 100;

  const shown = (value: number | null, digits: number, unit: string) =>
    value === null ? "—" : `${value.toFixed(digits)} ${unit}`;

  async function copyLink() {
    const link = `${window.location.origin}/gridreplay?event=${replay.event.id}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="replay-live">
      <div className="replay-header">
        <div>
          <h3>{eventTitle(replay.event)}</h3>
          <p className="availability">
            {replay.event.region} · {replay.event.marketDay} · {marketTime(replay.event.startAt)}–
            {marketTime(replay.event.endAt)} NEM · {replay.event.durationMinutes} minutes
            {replay.event.edgeIncomplete && " · touches the catalogue edge"}
          </p>
        </div>
        <div className="replay-actions">
          <Link className="ghost" to={`/batterylab?day=${replay.event.marketDay}`}>
            Open in BatteryLab →
          </Link>
          <button type="button" className="ghost" onClick={() => void copyLink()}>
            {copied ? "Link copied" : "Copy replay link"}
          </button>
        </div>
      </div>

      <div className="replay-controls">
        <button
          type="button"
          className="primary replay-play"
          aria-pressed={playing}
          onClick={() => {
            if (!playing && cursor >= data.count - 1) setCursor(spanStart);
            setPlaying(!playing);
          }}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <div className="seg" role="group" aria-label="Replay speed">
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              className={speed === value ? "on" : ""}
              aria-pressed={speed === value}
              onClick={() => setSpeed(value)}
            >
              {value}×
            </button>
          ))}
        </div>
        <input
          type="range"
          className="replay-slider"
          min={0}
          max={data.count - 1}
          value={cursor}
          aria-label="Replay position"
          onChange={(event) => {
            setPlaying(false);
            setCursor(Number(event.target.value));
          }}
        />
        <span className="replay-clock" aria-live="polite">
          {clock}
        </span>
      </div>

      <dl className="replay-readout">
        <div>
          <dt>Price</dt>
          <dd>{shown(price, 2, "AUD/MWh")}</dd>
        </div>
        <div>
          <dt>Demand</dt>
          <dd>{shown(demand, 0, "MW")}</dd>
        </div>
        <div>
          <dt>Net flow</dt>
          <dd>
            {netFlow === null ? "—" : `${netFlow.toFixed(0)} MW ${netFlow >= 0 ? "in" : "out"}`}
          </dd>
        </div>
        <div>
          <dt>Renewable share</dt>
          <dd>{renewableShare === null ? "—" : `${renewableShare.toFixed(1)}%`}</dd>
        </div>
      </dl>
      <p className="hint">
        Prices are interval-end labelled; demand, flows and generation use the source interval
        label. Gaps appear where observations are missing.
      </p>

      <ReplayCharts
        replay={replay}
        data={data}
        cursor={cursor}
        span={[spanStart, spanEnd]}
        onSelect={setCursor}
      />

      <details className="method">
        <summary>Provenance and pinned revisions</summary>
        <table className="job-meta">
          <tbody>
            <tr>
              <th scope="row">Detector</th>
              <td>
                {replay.event.type} · {replay.event.detectorVersion}
              </td>
            </tr>
            <tr>
              <th scope="row">Parameters</th>
              <td>
                {Object.entries(replay.event.detectorParams as Record<string, number>)
                  .map(([key, value]) => `${key} = ${value}`)
                  .join(" · ")}
              </td>
            </tr>
            <tr>
              <th scope="row">Event version</th>
              <td>
                v{replay.event.version}
                {replay.event.superseded && " (superseded by a newer version)"}
              </td>
            </tr>
            <tr>
              <th scope="row">Pinned revisions</th>
              <td>
                {Object.keys(replay.event.sourceRevisions as object).length} series/day revisions
                materialised at publication
              </td>
            </tr>
          </tbody>
        </table>
        <p className="hint">
          Charts use approximate plotting numbers. This replay reads stored revisions captured at
          publication, so later corrections do not change it.
        </p>
      </details>
    </div>
  );
}
