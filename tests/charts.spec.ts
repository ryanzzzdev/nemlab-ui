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
  await page.goto("/batterylab");
  await page.getByLabel("Market day").fill(day);
  await page.getByRole("button", { name: "Check prices" }).click();
  await expect(page.getByRole("heading", { name: "Incomplete", exact: true })).toBeVisible();
});

test("lazy charts preserve gaps and share keyboard cursor and zoom", async ({ page }, info) => {
  expect(
    await page.evaluate(() =>
      performance.getEntriesByType("resource").some((entry) => entry.name.includes("PriceCharts-")),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Show chart prototype" }).click();
  const cursor = page.locator('.linked-chart path[stroke="#b04a2f"]');
  await expect(cursor).toHaveCount(2);
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
  const path = await page.locator('.linked-chart path[stroke="#163e35"]').first().getAttribute("d");
  expect(path?.match(/M/g)?.length).toBeGreaterThan(1);
  await page.getByLabel("Visible window").selectOption("1");
  await range.focus();
  await range.press("End");
  await range.press("ArrowLeft");
  const zoomed = await cursor.evaluateAll((paths) =>
    paths.map((path) => path.getBoundingClientRect().x),
  );
  expect(Math.abs(zoomed[0]! - zoomed[1]!)).toBeLessThan(1);
  await page.getByLabel("Visible window").selectOption("0");
  const full = await cursor.evaluateAll((paths) =>
    paths.map((path) => path.getBoundingClientRect().x),
  );
  expect(Math.abs(full[0]! - full[1]!)).toBeLessThan(1);
  expect(zoomed[0]! - full[0]!).toBeGreaterThan(80);
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

test("pointing or tapping either panel moves both cursors; resize and reopen work", async ({
  page,
  isMobile,
}) => {
  await page.getByRole("button", { name: "Show chart prototype" }).click();
  const canvas = page.locator(".linked-chart");
  await expect(canvas.locator("svg")).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  if (isMobile) await page.touchscreen.tap(box.x + 65 + (box.width - 85) * 0.4, box.y + 110);
  else await page.mouse.move(box.x + 65 + (box.width - 85) * 0.4, box.y + 110);
  const range = page.getByRole("slider", { name: "Selected interval" });
  await expect.poll(async () => Number(await range.inputValue())).toBeGreaterThan(100);
  if (isMobile) await page.touchscreen.tap(box.x + 65 + (box.width - 85) * 0.7, box.y + 350);
  else await page.mouse.move(box.x + 65 + (box.width - 85) * 0.7, box.y + 350);
  await expect.poll(async () => Number(await range.inputValue())).toBeGreaterThan(190);
  const positions = await canvas
    .locator('path[stroke="#b04a2f"]')
    .evaluateAll((paths) => paths.map((path) => path.getBoundingClientRect().x));
  expect(positions).toHaveLength(2);
  expect(Math.abs(positions[0]! - positions[1]!)).toBeLessThan(1);
  await page.setViewportSize({ width: 320, height: 740 });
  await expect
    .poll(async () => Number(await canvas.locator("svg").getAttribute("width")))
    .toBeLessThanOrEqual(272);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Hide chart prototype" }).click();
  await expect(page.locator(".linked-chart")).toHaveCount(0);
  await page.getByRole("button", { name: "Show chart prototype" }).click();
  await expect(page.locator('.linked-chart path[stroke="#b04a2f"]')).toHaveCount(2);
  await expect(page.locator(".chart-readout")).toContainText("00:05 NEM UTC+10");
});

test("a failed chart download leaves the exact table available", async ({ page }) => {
  await page.route("**/assets/PriceCharts-*.js", (route) => route.abort());
  await page.getByRole("button", { name: "Show chart prototype" }).click();
  await expect(page.getByRole("alert")).toContainText("Charts could not load");
  await expect(page.getByRole("row")).toHaveCount(289);
});
