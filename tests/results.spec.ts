import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { coverage, day, series } from "./fixtures/prices";
import { job, traded } from "./fixtures/simulation";
import { hoverChartInterval } from "./helpers";

test.use({ timezoneId: "Australia/Sydney" });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/prices/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("coverage?")
        ? { region: "NSW1", days: [coverage("COMPLETE")] }
        : series("COMPLETE"),
    }),
  );
  await page.route("**/api/v1/simulations**", (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({ status: 202, json: job("SUCCEEDED") });
    return route.fulfill({ json: traded() });
  });
  await page.goto("/batterylab");
  await page.getByLabel("Simulation day").fill(day);
});

async function submit(page: Page) {
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByRole("heading", { name: "Stored result ready" })).toBeVisible();
}

test("comparison totals, breakdown and explanation agree with the stored result", async ({
  page,
}, info) => {
  await submit(page);
  const comparison = page.locator(".result-comparison");
  await expect(comparison.getByRole("heading", { name: "Result comparison" })).toBeVisible();
  await expect(comparison).toContainText("benchmark, not a forecast");
  // Stat cards: fixed traded through flat prices and lost its fees; hindsight
  // captured the late -10/80 prices the earliest-first schedule missed.
  await expect(comparison.locator(".stat-value").nth(0)).toHaveText("-$2.38");
  await expect(comparison.locator(".stat-value").nth(1)).toHaveText("$54.28");
  await expect(comparison.locator(".stat-value").nth(2)).toHaveText("$56.67");
  await expect(comparison.locator(".stat-value").nth(3)).toHaveText("0.205 MWh");
  const explain = comparison.locator(".result-explain");
  await expect(explain).toContainText("stored-energy headroom");
  await expect(explain).toContainText("negative prices — a credit, not a cost");
  await expect(explain).toContainText("earned $56.67 more than the fixed schedule");
  await expect(explain).toContainText("dual bound $54.29");
  // The financial breakdown precedes the charts in the result column.
  const breakdown = comparison.getByRole("table").first();
  await expect(breakdown).toContainText("2.105");
  await expect(breakdown).toContainText("1.900");
  await expect(breakdown).toContainText("-$3.33 (credit)");
  await expect(breakdown).toContainText("$53.33");
  await expect(breakdown).toContainText("$2.00");
  await expect(breakdown).toContainText("$0.38");
  await expect(breakdown).toContainText("Modelled margin");
  // The exact stored price string survives verbatim in the collapsed interval table.
  const detail = page.locator("summary", { hasText: "Interval detail" });
  await expect(detail).toBeVisible();
  await detail.click();
  const intervals = comparison.getByRole("table").last();
  await expect(intervals).toContainText("123.4567890123456789");
  const negative = intervals.getByRole("row").filter({ hasText: "13:25" });
  await expect(negative).toContainText("-10");
  await expect(negative).toContainText("+1.000");
  await expect(comparison.getByText(/synthetic/i)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("result-comparison.png"), fullPage: true });
});

test("result charts render automatically at full day and share one cursor", async ({
  page,
  isMobile,
}, info) => {
  await submit(page);
  // No show/hide control — the four panels arrive with the result.
  await expect(
    page.getByRole("button", { name: /comparison charts|chart prototype/i }),
  ).toHaveCount(0);
  const plots = page.locator(".chart-plot");
  await expect(plots).toHaveCount(4);
  await expect(plots.first().locator("svg")).toBeVisible();
  const cursors = page.locator('.chart-plot path[stroke="#b04a2f"][stroke-width="2"]');
  await expect(cursors).toHaveCount(4);
  // No visible-window or interval-slider controls: the panels always cover the
  // full day and interval values come from the connected axis tooltips.
  await expect(page.getByLabel("Visible window")).toHaveCount(0);
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expect(page.locator(".chart-readout")).toHaveCount(0);
  // Hovering the price panel shows the exact stored price at that interval,
  // and the connected panels show their own values for the same interval.
  await hoverChartInterval(page, { panel: 0, interval: 0 });
  await expect(plots.first()).toContainText("interval 1/288");
  await expect(plots.first()).toContainText("123.4567890123456789 AUD/MWh");
  await expect(plots.nth(1)).toContainText("interval 1/288");
  await expect(plots.nth(3)).toContainText("interval 1/288");
  // The negative-price interval reports the price and the hindsight dispatch.
  await hoverChartInterval(page, { panel: 1, interval: 160 });
  await expect(plots.nth(1)).toContainText("interval 161/288");
  await expect(plots.nth(1)).toContainText("+1.000");
  // The domain always ends at 00:00 +1 day — no window narrows it.
  await hoverChartInterval(page, { panel: 0, interval: 287 });
  await expect(plots.first()).toContainText("interval 288/288");
  await expect(plots.first()).toContainText("00:00 +1 day");
  // The selected mark lines stay aligned; arrow keys move them one interval.
  const aligned = async () =>
    Math.max(
      ...(await cursors.evaluateAll((paths) => paths.map((p) => p.getBoundingClientRect().x))),
    ) -
    Math.min(
      ...(await cursors.evaluateAll((paths) => paths.map((p) => p.getBoundingClientRect().x))),
    );
  expect(await aligned()).toBeLessThan(1);
  const before = (await cursors.first().boundingBox())!.x;
  await page.locator(".charts").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await cursors.first().boundingBox())!.x - before)
    .toBeGreaterThan(0);
  expect(await aligned()).toBeLessThan(1);
  // Clicking inside any one panel moves all four selected cursors together;
  // hover alone only shows the native tooltips.
  const firstPlot = plots.first();
  await firstPlot.scrollIntoViewIfNeeded();
  const box = (await firstPlot.boundingBox())!;
  const tap = isMobile
    ? page.touchscreen.tap.bind(page.touchscreen)
    : (x: number, y: number) => page.mouse.click(x, y);
  await tap(box.x + 48 + (box.width - 60) * 0.6, box.y + box.height / 2);
  await expect
    .poll(async () => (await cursors.first().boundingBox())!.x - (box.x + 48))
    .toBeGreaterThan((box.width - 60) * 0.55);
  const lastPlot = plots.nth(3);
  await lastPlot.scrollIntoViewIfNeeded();
  const marginBox = (await lastPlot.boundingBox())!;
  await tap(marginBox.x + 48 + (marginBox.width - 60) * 0.3, marginBox.y + marginBox.height / 2);
  await expect
    .poll(async () => (await cursors.first().boundingBox())!.x - (marginBox.x + 48))
    .toBeLessThan((marginBox.width - 60) * 0.35);
  expect(await aligned()).toBeLessThan(1);
  await page.screenshot({ path: info.outputPath("result-charts.png"), fullPage: true });
});

test("the power panel switches strategies and the shared cursor survives appearance changes", async ({
  page,
}, info) => {
  await submit(page);
  const plots = page.locator(".chart-plot");
  await expect(plots).toHaveCount(4);
  // The same segmented control sits on all three strategy panels and stays in
  // sync; the energy and margin panels emphasise the selected strategy.
  const cards = page.locator(".chart-card");
  const power = cards.nth(1);
  const fixed = power.getByRole("button", { name: "Fixed", exact: true });
  const hindsight = power.getByRole("button", { name: "Hindsight", exact: true });
  await expect(hindsight).toHaveAttribute("aria-pressed", "true");
  await fixed.click();
  await expect(fixed).toHaveAttribute("aria-pressed", "true");
  await expect(cards.nth(2).getByRole("button", { name: "Fixed", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(cards.nth(3).getByRole("button", { name: "Fixed", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await hindsight.click();
  // Hovering a panel shows a per-panel tooltip; connected charts follow.
  await plots.first().hover({ position: { x: 200, y: 60 } });
  await expect(plots.first()).toContainText(/interval \d+\/288/);
  await expect(plots.first()).toContainText("AUD/MWh");
  await expect(plots.nth(1)).toContainText(/interval \d+\/288/);
  // Arrow keys move the shared selected cursor without a slider.
  await page.locator(".charts").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const lightCursors = page.locator('.chart-plot path[stroke="#b04a2f"][stroke-width="2"]');
  const beforeX = (await lightCursors.first().boundingBox())!.x;
  await page.getByRole("combobox", { name: "Appearance" }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(plots.first().locator("svg")).toBeVisible();
  const cursors = page.locator('.chart-plot path[stroke="#ffa48b"][stroke-width="2"]');
  await expect(cursors).toHaveCount(4);
  // The selected interval survives the theme swap at the same position.
  expect(Math.abs((await cursors.first().boundingBox())!.x - beforeX)).toBeLessThan(1);
  // Hovering the first interval still reports its exact price in the dark card.
  await hoverChartInterval(page, { panel: 0, interval: 0 });
  await expect(plots.first()).toContainText("interval 1/288");
  await expect(plots.first()).toContainText("123.4567890123456789 AUD/MWh");
  const aligned = await cursors.evaluateAll((paths) =>
    paths.map((path) => path.getBoundingClientRect().x),
  );
  expect(Math.max(...aligned) - Math.min(...aligned)).toBeLessThan(1);
  await page.screenshot({ path: info.outputPath("result-charts-dark.png"), fullPage: true });
});

test("result layout and disclosures stay usable at 320px", async ({ page }) => {
  await submit(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(
    page.locator(".result-comparison").getByRole("heading", { name: "Result comparison" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // The long simulation identifier wraps inside the narrow scenario panel.
  const job = page.locator(".job");
  await expect(job.locator(".revision").first()).toBeVisible();
  const wrap = await job.evaluate(
    (el) => el.scrollWidth <= el.clientWidth + 1 && el.clientWidth <= 320,
  );
  expect(wrap).toBe(true);
  const plots = page.locator(".chart-plot");
  await expect(plots).toHaveCount(4);
  await expect
    .poll(async () => Number(await plots.first().locator("svg").getAttribute("width")))
    .toBeLessThanOrEqual(290);
  await page.locator("summary", { hasText: "Interval detail" }).click();
  await expect(page.getByRole("table").last().getByRole("row").first()).toBeVisible();
});

test("a failed chart download keeps the comparison tables", async ({ page }) => {
  // Abort the lazy chunk before submission so the import fails on first render.
  await page.route("**/assets/ResultCharts-*.js", (route) => route.abort());
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByRole("alert")).toContainText("Charts could not load");
  await expect(page.getByText("Modelled margin")).toBeVisible();
  await page.locator("summary", { hasText: "Interval detail" }).click();
  await expect(page.getByText("123.4567890123456789")).toBeVisible();
});
