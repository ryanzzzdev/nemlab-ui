import { expect, test } from "@playwright/test";
import { coverage, day, series } from "./fixtures/prices";
import { job, traded } from "./fixtures/simulation";

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
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByRole("heading", { name: "Stored result ready" })).toBeVisible();
});

test("comparison totals, breakdown and explanation agree with the stored result", async ({
  page,
}, info) => {
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
  const breakdown = comparison.getByRole("table").first();
  await expect(breakdown).toContainText("2.105");
  await expect(breakdown).toContainText("1.900");
  await expect(breakdown).toContainText("-$3.33 (credit)");
  await expect(breakdown).toContainText("$53.33");
  await expect(breakdown).toContainText("$2.00");
  await expect(breakdown).toContainText("$0.38");
  await expect(breakdown).toContainText("Modelled margin");
  // The exact stored price string survives verbatim in the interval table.
  const intervals = comparison.getByRole("table").last();
  await expect(intervals).toContainText("123.4567890123456789");
  const negative = intervals.getByRole("row").filter({ hasText: "13:25" });
  await expect(negative).toContainText("-10");
  await expect(negative).toContainText("+1.000");
  await expect(comparison.getByText(/synthetic/i)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("result-comparison.png"), fullPage: true });
});

test("result charts share one cursor, window and keyboard interval control", async ({
  page,
  isMobile,
}, info) => {
  await page.getByRole("button", { name: "Show comparison charts" }).click();
  const canvas = page.locator(".result-chart");
  await expect(canvas.locator("svg")).toBeVisible();
  const cursors = canvas.locator('path[stroke="#b04a2f"], path[stroke="#ffa48b"]');
  await expect(cursors).toHaveCount(4);
  const readout = page.locator(".result-comparison .chart-readout");
  await expect(readout).toContainText("00:05 NEM UTC+10");
  await expect(readout).toContainText("123.4567890123456789 AUD/MWh");
  const range = page.getByRole("slider", { name: "Selected interval" });
  await range.focus();
  await range.press("ArrowRight");
  await expect(readout).toContainText("00:10 NEM UTC+10");
  await range.evaluate((el: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, "160");
  await expect(readout).toContainText("13:25 NEM UTC+10");
  await expect(readout).toContainText("-10 AUD/MWh");
  await expect(readout).toContainText("Hindsight: +1.000 MW");
  const aligned = await cursors.evaluateAll((paths) =>
    paths.map((path) => path.getBoundingClientRect().x),
  );
  expect(Math.max(...aligned) - Math.min(...aligned)).toBeLessThan(1);
  await page.getByLabel("Visible window").selectOption("4");
  await range.focus();
  await range.press("End");
  await expect(readout).toContainText("00:00 +1 day NEM UTC+10");
  const zoomed = await cursors.evaluateAll((paths) =>
    paths.map((path) => path.getBoundingClientRect().x),
  );
  expect(Math.max(...zoomed) - Math.min(...zoomed)).toBeLessThan(1);
  await page.getByLabel("Visible window").selectOption("0");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const tap = isMobile
    ? page.touchscreen.tap.bind(page.touchscreen)
    : page.mouse.move.bind(page.mouse);
  await tap(box.x + 65 + (box.width - 85) * 0.6, box.y + 100);
  await expect.poll(async () => Number(await range.inputValue())).toBeGreaterThan(150);
  await tap(box.x + 65 + (box.width - 85) * 0.3, box.y + 700);
  await expect.poll(async () => Number(await range.inputValue())).toBeLessThan(120);
  await page.screenshot({ path: info.outputPath("result-charts.png"), fullPage: true });
});

test("result charts keep the shared cursor when appearance changes", async ({ page }, info) => {
  await page.getByRole("button", { name: "Show comparison charts" }).click();
  const canvas = page.locator(".result-chart");
  await expect(canvas.locator("svg")).toBeVisible();
  const readout = page.locator(".result-comparison .chart-readout");
  const range = page.getByRole("slider", { name: "Selected interval" });
  await range.focus();
  await range.press("ArrowRight");
  await page.getByRole("combobox", { name: "Appearance" }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(canvas.locator("svg")).toBeVisible();
  const cursors = canvas.locator('path[stroke="#ffa48b"]');
  await expect(cursors).toHaveCount(4);
  await range.press("ArrowRight");
  await expect(readout).toContainText("00:15 NEM UTC+10");
  await expect(readout).toContainText("Price: 0 AUD/MWh");
  await page.getByLabel("Visible window").selectOption("4");
  const aligned = await cursors.evaluateAll((paths) =>
    paths.map((path) => path.getBoundingClientRect().x),
  );
  expect(Math.max(...aligned) - Math.min(...aligned)).toBeLessThan(1);
  await page.screenshot({ path: info.outputPath("result-charts-dark.png"), fullPage: true });
});

test("result layout and tables stay usable at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(
    page.locator(".result-comparison").getByRole("heading", { name: "Result comparison" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Show comparison charts" }).click();
  const canvas = page.locator(".result-chart");
  await expect(canvas.locator("svg")).toBeVisible();
  await expect
    .poll(async () => Number(await canvas.locator("svg").getAttribute("width")))
    .toBeLessThanOrEqual(288);
});

test("a failed chart download keeps the comparison tables", async ({ page }) => {
  await page.route("**/assets/ResultCharts-*.js", (route) => route.abort());
  await page.getByRole("button", { name: "Show comparison charts" }).click();
  await expect(page.getByRole("alert")).toContainText("Charts could not load");
  await expect(page.getByText("Modelled margin")).toBeVisible();
  await expect(page.getByText("123.4567890123456789")).toBeVisible();
});
