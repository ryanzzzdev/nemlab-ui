import { BatteryWorkspace } from "./simulation/BatteryWorkspace";
import { PriceExplorer } from "./prices/PriceExplorer";
import { Link } from "react-router";
import { Page } from "./components/Page";

export function Home() {
  return (
    <Page
      title="NEMLab — Explore the electricity market"
      eyebrow="Australia’s National Electricity Market"
      heading="A closer look at the electricity market."
      introduction="Explore how batteries trade energy and how the grid changes through time. Our interactive tools are taking shape."
    >
      <div className="features">
        <section aria-labelledby="battery-heading">
          <p className="feature-number" aria-hidden="true">
            01
          </p>
          <h2 id="battery-heading">BatteryLab</h2>
          <p>Compare battery trading strategies using historical electricity prices.</p>
          <p className="availability">Coming soon</p>
          <Link to="/batterylab">
            Explore BatteryLab <span aria-hidden="true">→</span>
          </Link>
        </section>
        <section aria-labelledby="grid-heading">
          <p className="feature-number" aria-hidden="true">
            02
          </p>
          <h2 id="grid-heading">GridReplay</h2>
          <p>Explore notable market periods and follow the changing energy mix.</p>
          <p className="availability">Coming soon</p>
          <Link to="/gridreplay">
            Explore GridReplay <span aria-hidden="true">→</span>
          </Link>
        </section>
      </div>
    </Page>
  );
}

export function BatteryLab() {
  return (
    <Page
      title="BatteryLab — NEMLab"
      eyebrow="BatteryLab"
      heading="What could a battery do?"
      introduction="Compare a fixed schedule, an all-day price rule and perfect hindsight."
    >
      <BatteryWorkspace />
    </Page>
  );
}

export function Prices() {
  return (
    <Page
      title="Prices — NEMLab"
      eyebrow="Prices"
      heading="Explore electricity prices"
      introduction="Read stored five-minute prices for a completed NEM market day. Missing observations stay visible as gaps; reading prices never imports data or runs a simulation."
    >
      <PriceExplorer />
    </Page>
  );
}

export function GridReplay() {
  return (
    <Page
      title="GridReplay — NEMLab"
      eyebrow="GridReplay"
      heading="See the story behind a market day."
      introduction="Explore historical periods through aligned views of electricity prices and the grid’s changing energy mix."
    >
      <section className="notice" aria-labelledby="grid-status">
        <h2 id="grid-status">Replay is being built</h2>
        <p>
          The event catalogue and replay controls are not available yet. No market events are shown
          on this page.
        </p>
      </section>
      <section className="replay-catalogue" aria-labelledby="catalogue-heading">
        <div className="section-heading">
          <h2 id="catalogue-heading">Event catalogue</h2>
          <span className="availability">Historical NEM observations</span>
        </div>
        <div className="event-types" aria-label="Planned event types">
          <span>Negative-price runs</span>
          <span>Price spikes</span>
          <span>Renewable peaks</span>
          <span>Demand ramps</span>
        </div>
        <div className="empty-state">
          <span className="empty-symbol" aria-hidden="true">
            ↗
          </span>
          <h3>The next market story starts here</h3>
          <p>
            Published events will appear here once the catalogue is connected.
            <br />
            There are no event results to display yet.
          </p>
        </div>
      </section>
      <section className="replay-preview" aria-labelledby="replay-heading">
        <div className="section-heading">
          <h2 id="replay-heading">A shared view of the day</h2>
          <span className="availability">Replay coming later</span>
        </div>
        <div className="replay-panels">
          {[
            ["Regional reference price", "AUD/MWh"],
            ["Scheduled demand", "MW"],
            ["Generation by technology", "MW"],
            ["Regional flows", "MW"],
          ].map(([label, unit]) => (
            <div className="replay-panel" key={label}>
              <h3>
                {label} <span>{unit}</span>
              </h3>
              <p>Waiting for replay data</p>
            </div>
          ))}
        </div>
      </section>
      <section className="prose" aria-labelledby="grid-plan">
        <h2 id="grid-plan">Follow the evidence</h2>
        <p>
          The planned experience will let you explore notable periods, inspect the available data
          and move through time with a shared chart cursor.
        </p>
        <p>
          Gaps in the source data will stay visible. A missing observation does not mean zero
          generation or a zero price.
        </p>
        <Link to="/methodology">Read about data and limitations</Link>
      </section>
    </Page>
  );
}

export function Methodology() {
  return (
    <Page
      title="Methodology — NEMLab"
      eyebrow="Methodology"
      heading="Understand what the numbers mean."
      introduction="NEMLab explores historical data and simplified models. These principles guide the tools being built."
    >
      <div className="prose methodology">
        <section aria-labelledby="historical-data">
          <h2 id="historical-data">Historical data, with visible gaps</h2>
          <p>
            The backend stores electricity prices sourced from Open Electricity. Prices are in
            Australian dollars per megawatt-hour (AUD/MWh), at five-minute intervals.
          </p>
          <p>
            A NEM market day uses a fixed UTC+10 offset, including during daylight saving. Complete
            days contain 288 intervals. Missing observations are kept distinct from zero.
          </p>
          <p>
            Stored revisions preserve which data a calculation uses. BatteryLab lets you inspect
            stored prices and their coverage, and submit a scenario for a complete market day.
          </p>
        </section>
        <section aria-labelledby="fair-comparison">
          <h2 id="fair-comparison">Two strategies, the same limits</h2>
          <p>
            The initial battery comparison uses one charging window followed by one discharging
            window. Both strategies use the same battery, costs and windows, and finish with the
            energy they started with.
          </p>
          <p>
            A fixed schedule is chosen without looking at future prices. Hindsight can see the whole
            day’s prices and may choose not to trade. It is only described as optimal when the
            calculation establishes that result within its numerical tolerance.
          </p>
        </section>
        <section aria-labelledby="model-limits">
          <h2 id="model-limits">Trading margin is not investment return</h2>
          <p>
            The model accounts for energy purchases, sales, conversion losses and selected variable
            costs. It assumes the battery’s trades do not change market prices.
          </p>
          <p>
            It excludes capital and financing costs, household tariffs, ancillary-service revenue
            and detailed network charges. Simulated trading margin is not actual facility revenue.
          </p>
        </section>
      </div>
    </Page>
  );
}

export function NotFound() {
  return (
    <Page
      title="Page not found — NEMLab"
      eyebrow="Page not found"
      heading="This page isn’t here."
      introduction="The address may be incorrect, or this page may have moved."
    >
      <Link className="return-link" to="/">
        Return to NEMLab home
      </Link>
    </Page>
  );
}
