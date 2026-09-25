import { expect, test } from "@playwright/test";
import { coverage, day, series } from "./fixtures/prices";
import { hoverChartInterval } from "./helpers";

test.use({ timezoneId: "Australia/Sydney" });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("coverage?")
        ? { region: "NSW1", days: [coverage("INCOMPLETE")] }
        : series("INCOMPLETE"),
    }),
  );
  await page.goto("/prices");
  await page.getByLabel("Market day").fill(day);
});

test("the real price chart loads lazily, preserves gaps and tracks the cursor", async ({
  page,
  isMobile,
}, info) => {
  expect(
    await page.evaluate(() =>
      performance.getEntriesByType("resource").some((entry) => entry.name.includes("PriceCharts-")),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Check prices" }).click();
  await expect(page.getByRole("heading", { name: "Incomplete", exact: true })).toBeVisible();
  const plot = page.locator(".chart-plot");
  await expect(plot.locator("svg")).toBeVisible();
  // A single real price panel — no synthetic trace anywhere on the page.
  await expect(plot).toHaveCount(1);
  await expect(page.getByText(/synthetic/i)).toHaveCount(0);
  const cursor = page.locator('.chart-plot path[stroke="#b04a2f"][stroke-width="2"]');
  await expect(cursor).toHaveCount(1);
  // Gaps stay disconnected: the line renders multiple M segments. Assert
  // before hovering — the series path briefly re-renders under emphasis.
  const path = await page.locator('.chart-plot path[stroke="#b45309"]').first().getAttribute("d");
  expect(path?.match(/M/g)?.length).toBeGreaterThan(1);
  // No visible-window or interval-slider controls remain: the chart always
  // covers the full day and interval values come from the axis tooltip.
  await expect(page.getByLabel("Visible window")).toHaveCount(0);
  await expect(page.getByRole("slider")).toHaveCount(0);
  // The axis tooltip reports the exact stored values for each state. Adjacent
  // intervals are sub-pixel on the narrow mobile plot, so the missing/null
  // checks run on desktop; mobile covers them through the exact table below.
  await hoverChartInterval(page, { panel: 0, interval: 0, scope: "body" });
  await expect(plot).toContainText("interval 1/288");
  await expect(plot).toContainText("123.4567890123456789 AUD/MWh");
  if (!isMobile) {
    await hoverChartInterval(page, { panel: 0, interval: 1, scope: "body" });
    await expect(plot).toContainText("-25 AUD/MWh");
    await hoverChartInterval(page, { panel: 0, interval: 3, scope: "body" });
    await expect(plot).toContainText("Missing");
    await hoverChartInterval(page, { panel: 0, interval: 4, scope: "body" });
    await expect(plot).toContainText("Source null");
  }
  // The last interval reaches 00:00 +1 day — the domain is the full day.
  await hoverChartInterval(page, { panel: 0, interval: 287, scope: "body" });
  await expect(plot).toContainText("interval 288/288");
  await expect(plot).toContainText("00:00 +1 day");
  // Arrow keys move the selected cursor one interval at a time. A single
  // interval is sub-pixel on the narrow plot, so press a few.
  const box = (await plot.boundingBox())!;
  await plot.focus();
  const step = (box.width - 60) / 287;
  const startX = (await cursor.boundingBox())!.x;
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await cursor.boundingBox())!.x - startX)
    .toBeGreaterThan(step * 1.5);
  // Clicking inside the plot moves the selected cursor there.
  await page.mouse.click(box.x + 48 + (box.width - 60) * 0.5, box.y + box.height / 2);
  await expect
    .poll(async () => (await cursor.boundingBox())!.x - (box.x + 48))
    .toBeGreaterThan((box.width - 60) * 0.45);
  await page.screenshot({ path: info.outputPath("charts.png"), fullPage: true, scale: "css" });
  const durations = await page.evaluate(() =>
    performance.getEntriesByName("nemlab-chart-initial-render").map((entry) => entry.duration),
  );
  expect(durations.length).toBeGreaterThan(0);
  expect(durations.at(-1)).toBeLessThan(2000);
  await info.attach("render-timing", {
    body: JSON.stringify(durations),
    contentType: "application/json",
  });
});

test("pointing or tapping the panel moves the cursor; narrow layout stays usable", async ({
  page,
  isMobile,
}) => {
  await page.getByRole("button", { name: "Check prices" }).click();
  const plot = page.locator(".chart-plot");
  await expect(plot.locator("svg")).toBeVisible();
  await plot.scrollIntoViewIfNeeded();
  const box = (await plot.boundingBox())!;
  const cursor = page.locator('.chart-plot path[stroke="#b04a2f"][stroke-width="2"]');
  const tap = isMobile
    ? page.touchscreen.tap.bind(page.touchscreen)
    : (x: number, y: number) => page.mouse.click(x, y);
  await tap(box.x + 48 + (box.width - 60) * 0.4, box.y + 90);
  const gridX = async () => (await cursor.boundingBox())!.x - (box.x + 48);
  await expect.poll(gridX).toBeGreaterThan((box.width - 60) * 0.35);
  await tap(box.x + 48 + (box.width - 60) * 0.7, box.y + 90);
  await expect.poll(gridX).toBeGreaterThan((box.width - 60) * 0.65);
  await page.setViewportSize({ width: 320, height: 740 });
  // Move the pointer off the plot so its hover tooltip clears before measuring.
  await page.mouse.move(5, 5);
  await expect
    .poll(async () => Number(await plot.locator("svg").getAttribute("width")))
    .toBeLessThanOrEqual(290);
  const wide = await page.evaluate(() => {
    const offenders: string[] = [];
    document.querySelectorAll("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth + 1 && !(el as HTMLElement).closest("svg"))
        offenders.push(
          `${el.tagName}.${String((el as HTMLElement).className).slice(0, 40)} right=${r.right.toFixed(0)}`,
        );
    });
    return { scrollWidth: document.documentElement.scrollWidth, offenders: offenders.slice(0, 8) };
  });
  expect(
    wide.scrollWidth <= 321,
    `elements past 320px viewport: ${wide.offenders.join(" | ")}`,
  ).toBe(true);
});

test("a failed chart download keeps the collapsed exact table available", async ({ page }) => {
  await page.route("**/assets/PriceCharts-*.js", (route) => route.abort());
  await page.getByRole("button", { name: "Check prices" }).click();
  await expect(page.getByRole("alert")).toContainText("Charts could not load");
  await page.locator("summary", { hasText: "Exact interval values" }).click();
  await expect(page.getByRole("row")).toHaveCount(289);
});
