import { BatteryWorkspace } from "./simulation/BatteryWorkspace";
import { GridReplayWorkspace } from "./gridreplay/GridReplayWorkspace";
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
      heading="What could a battery do in a market day?"
      introduction="Compare three trading strategies on one market day — a fixed schedule, an all-day price rule and perfect hindsight."
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
      introduction="Explore published market events and replay the day through aligned views of price, demand, generation mix and interconnector flows."
    >
      <GridReplayWorkspace />
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
