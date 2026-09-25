import type { Page } from "@playwright/test";

// Scenario groups collapse by default; open one before filling its fields.
export function openSection(page: Page, name: string) {
  return page.locator("summary", { hasText: name }).click();
}

// Hover the Nth chart panel at a given 5-minute interval so its axis tooltip
// opens. Charts use a full-day category axis with a 48px left / 12px right
// grid inset; interval i sits at grid.left + plotWidth * (i / 287).
export async function hoverChartInterval(
  page: Page,
  options: { panel: number; interval: number; scope?: string },
) {
  const plot = page
    .locator(`${options.scope ?? ".result-comparison"} .chart-plot`)
    .nth(options.panel);
  await plot.scrollIntoViewIfNeeded();
  const box = (await plot.boundingBox())!;
  const x = box.x + 48 + (box.width - 60) * (options.interval / 287);
  await page.mouse.move(x, box.y + box.height / 2);
  return plot;
}
