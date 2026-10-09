import type { SessionView } from "../api";
import { fmtDateTime } from "../format";
import { Drawer } from "./Drawer";

const STEPS = [
  {
    name: "Load data",
    text: "The owner submits a bounded window of grid observations and prices. Work lands on durable queues, in chunks of at most 31 days.",
  },
  {
    name: "Check coverage",
    text: "Coverage shows what is actually stored — complete, partial or missing per day — before anything is published.",
  },
  {
    name: "Detect & publish",
    text: "Publishing runs the detector suite over a chosen window and makes the resulting catalogue the region's current public view.",
  },
  {
    name: "Explore",
    text: "GridReplay links open the published snapshot. Old links keep working — each replay is frozen at publish time.",
  },
];

const GLOSSARY: [string, string][] = [
  [
    "Grid observations",
    "Market data fetched from the source: demand, interconnector flows and (optionally) per-fuel power series. Stored separately from prices.",
  ],
  [
    "Prices",
    "The 5-minute regional price series, imported by price-refresh jobs. A successful grid import does not imply prices are present.",
  ],
  [
    "Market day",
    "NEM data is keyed by calendar day in the fixed NEM offset (UTC+10), not your local timezone.",
  ],
  [
    "Job",
    "A unit of queued work (grid import or price refresh). Jobs hold checkpoints and retry state; stored revisions are the data they produced.",
  ],
  [
    "Complete vs partial coverage",
    "A day is complete when every required market series is fully stored; partial when only some are. Optional power series never decide the summary.",
  ],
  [
    "Detector vs Highlights",
    "The detector suite finds candidate events in published data. Highlights are a bounded, ranked selection of those events for the public landing view — not a second detector and not a market-wide rarity claim.",
  ],
  [
    "Publication",
    "An atomic snapshot that becomes the region's public catalogue. The latest publication replaces the pointer; it does not rewrite older publications or their replay links.",
  ],
  [
    "Baseline readiness",
    "Unusual-ramp detection compares each day against the preceding 90 days. A candidate needs at least 60 complete days and 20 same-class (weekday/weekend) days — 'insufficient baseline' means we cannot tell, not that zero events occurred.",
  ],
  [
    "Replay links",
    "Every published event links to a frozen replay. New imports and new publications never change what an old replay shows.",
  ],
  [
    "Stop submitting vs cancel",
    "Pausing a load operation stops new chunk submissions only; chunks already queued keep running. Cancelling individual jobs is a separate, explicit act.",
  ],
];

/** Workflow steps + glossary shared by the contextual Help drawer and the
 * legacy /how-it-works route (until NEM-114 retires it). */
export function HelpContent() {
  return (
    <>
      <h3>The four steps</h3>
      <ol className="step-list">
        {STEPS.map((step) => (
          <li key={step.name}>
            <strong>{step.name}</strong>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
      <h3>Glossary</h3>
      <dl className="glossary">
        {GLOSSARY.map(([term, definition]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{definition}</dd>
          </div>
        ))}
      </dl>
      <h3>Event detection, briefly</h3>
      <p>
        The v2 detector recognises ordinary and unusual demand ramps, negative runs, price spikes,
        negative-to-high reversals and compound negative episodes. An <em>unusual</em> ramp is
        judged against the day&apos;s own 90-day baseline — so a region with thin history can
        honestly answer &ldquo;insufficient baseline&rdquo; rather than pretending no events
        happened.
      </p>
      <p className="hint">
        Examples here are illustrative. Live events live in the published catalogues on the
        Publications tab.
      </p>
    </>
  );
}

/** Contextual help for the workspace — the workflow and glossary travel with
 * the console instead of a separate page, plus the caller's role and session
 * expiry so viewers always see what their access covers. */
export function HelpDrawer({
  session,
  open,
  onClose,
}: {
  session: SessionView | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Drawer title="How the console works" open={open} onClose={onClose} wide>
      {session && (
        <p className="hint">
          Signed in as <strong>{session.name}</strong> —{" "}
          {session.role === "viewer"
            ? "read-only visitor access"
            : session.role === "owner"
              ? "owner access"
              : "access request in progress"}
          , session until {fmtDateTime(session.expiresAt)}.
          {session.role === "viewer" &&
            " Loading data and publishing are owner actions; you can inspect every stored, queued and published record."}
        </p>
      )}
      <HelpContent />
    </Drawer>
  );
}
