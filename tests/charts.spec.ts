import { expect, test } from "@playwright/test";
import { coverage, day, series } from "./fixtures/prices";

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
  const cursor = page.locator('.chart-plot path[stroke="#b04a2f"]');
  await expect(cursor).toHaveCount(1);
  const readout = page.locator(".chart-readout");
  await expect(readout).toContainText("123.4567890123456789 AUD/MWh");
  await expect(readout).toContainText("00:05 NEM UTC+10");
  const range = page.getByRole("slider", { name: "Selected interval" });
  await range.focus();
  await range.press("ArrowRight");
  await expect(readout).toContainText("-25 AUD/MWh");
  await range.press("ArrowRight");
  await range.press("ArrowRight");
  await expect(readout).toContainText("Missing");
  await range.press("ArrowRight");
  await expect(readout).toContainText("Source null");
  const path = await page.locator('.chart-plot path[stroke="#b45309"]').first().getAttribute("d");
  expect(path?.match(/M/g)?.length).toBeGreaterThan(1);
  const box = (await plot.boundingBox())!;
  await page.getByLabel("Visible window").selectOption("1");
  await range.focus();
  await range.press("End");
  const zoomedX = (await cursor.boundingBox())!.x - box.x;
  await page.getByLabel("Visible window").selectOption("0");
  const fullX = (await cursor.boundingBox())!.x - box.x;
  expect(zoomedX - fullX).toBeGreaterThan(80);
  await range.focus();
  await range.press("End");
  await expect(readout).toContainText("00:00 +1 day NEM UTC+10");
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
  if (isMobile) await page.touchscreen.tap(box.x + 48 + (box.width - 60) * 0.4, box.y + 90);
  else await page.mouse.move(box.x + 48 + (box.width - 60) * 0.4, box.y + 90);
  const range = page.getByRole("slider", { name: "Selected interval" });
  await expect.poll(async () => Number(await range.inputValue())).toBeGreaterThan(100);
  if (isMobile) await page.touchscreen.tap(box.x + 48 + (box.width - 60) * 0.7, box.y + 90);
  else await page.mouse.move(box.x + 48 + (box.width - 60) * 0.7, box.y + 90);
  await expect.poll(async () => Number(await range.inputValue())).toBeGreaterThan(190);
  await page.setViewportSize({ width: 320, height: 740 });
  await expect
    .poll(async () => Number(await plot.locator("svg").getAttribute("width")))
    .toBeLessThanOrEqual(290);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a failed chart download keeps the collapsed exact table available", async ({ page }) => {
  await page.route("**/assets/PriceCharts-*.js", (route) => route.abort());
  await page.getByRole("button", { name: "Check prices" }).click();
  await expect(page.getByRole("alert")).toContainText("Charts could not load");
  await page.locator("summary", { hasText: "Exact interval values" }).click();
  await expect(page.getByRole("row")).toHaveCount(289);
});
