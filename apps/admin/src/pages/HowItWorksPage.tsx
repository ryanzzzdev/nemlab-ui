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

export function HowItWorksPage() {
  return (
    <>
      <p className="eyebrow">How it works</p>
      <h1 tabIndex={-1}>The data workflow</h1>
      <p className="intro">
        Load data → check coverage → detect &amp; publish → explore. Every step is explicit; nothing
        publishes automatically.
      </p>
      <section className="card">
        <h2>The four steps</h2>
        <ol className="step-list">
          {STEPS.map((step, index) => (
            <li key={step.name}>
              <strong>
                {index + 1}. {step.name}
              </strong>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="card">
        <h2>Glossary</h2>
        <dl className="glossary">
          {GLOSSARY.map(([term, definition]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{definition}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="card">
        <h2>Event detection, briefly</h2>
        <p>
          The v2 detector recognises ordinary and unusual demand ramps, negative runs, price spikes,
          negative-to-high reversals and compound negative episodes. An <em>unusual</em> ramp is
          judged against the day&apos;s own 90-day baseline — so a region with thin history can
          honestly answer &ldquo;insufficient baseline&rdquo; rather than pretending no events
          happened.
        </p>
        <p className="hint">
          Examples here are illustrative. Live events live in the published catalogues on the
          Publications page.
        </p>
      </section>
    </>
  );
}
