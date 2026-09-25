import { expect, test } from "@playwright/test";
import { openSection } from "./helpers";

test("submits a real simulation and retrieves a worker-produced result", async ({ page }, info) => {
  await page.goto("/batterylab");
  await page.getByLabel("Simulation day").fill("2023-10-01");
  // Price thresholds are a default third strategy — the real worker runs the
  // threshold engine and the stored result carries all three strategies.
  await openSection(page, "Price thresholds");
  await page.getByLabel("Charge below (AUD/MWh)").fill("-50");
  await page.getByLabel("Discharge above (AUD/MWh)").fill("200");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByRole("heading", { name: "Stored result ready" })).toBeVisible({
    timeout: 25000,
  });
  await expect(page.getByRole("heading", { name: "Result comparison" })).toBeVisible();
  await expect(page.getByText("Modelled margin")).toBeVisible();
  await expect(page.locator(".stat").filter({ hasText: "Price thresholds margin" })).toBeVisible();
  await expect(
    page.locator(".chart-card").nth(1).getByRole("button", { name: "Thresholds", exact: true }),
  ).toBeVisible();
  await page.locator("summary", { hasText: "Interval detail" }).click();
  const intervals = page.locator("details", { hasText: "Interval detail" });
  await expect(
    intervals.getByRole("columnheader", { name: "Thresholds MW" }).first(),
  ).toBeVisible();
  await expect(intervals.getByRole("row")).toHaveCount(289);
  const first = await page.locator(".job .revision").first().textContent();
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByRole("heading", { name: "Stored result ready" })).toBeVisible();
  await expect(page.locator(".job .revision").first()).toHaveText(first!);
  // The saved link reopens the identical immutable result without resubmitting.
  expect(page.url()).toContain("simulation=");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Result comparison" })).toBeVisible({
    timeout: 25000,
  });
  await expect(page.locator(".job .revision").first()).toHaveText(first!);
  await expect(page.getByLabel("Charge below (AUD/MWh)")).toHaveValue("-50");
  await page.screenshot({
    path: info.outputPath("live-simulation.png"),
    fullPage: true,
    scale: "css",
  });
});

test("an incomplete day requests a real price fetch and reports its terminal failure", async ({
  page,
}) => {
  test.setTimeout(210_000);
  await page.goto("/batterylab");
  await page.getByLabel("Simulation day").fill("2023-10-02");
  await page.getByRole("button", { name: "Run simulation" }).click();
  // The submission enqueues a durable visitor fetch; the harness worker's
  // placeholder OE credential fails permanently, so three bounded attempts
  // end in an explicit terminal state rather than an endless pending loop.
  await expect(page.getByText("Fetching stored prices")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("alert")).toContainText("could not be fetched", {
    timeout: 190_000,
  });
  await page.goto("/batterylab?simulation=99999999-9999-4999-8999-999999999999");
  await expect(page.getByRole("alert")).toContainText("could not be found");
});

test("reads complete, incomplete and absent days through the real API proxy", async ({
  page,
}, info) => {
  await page.goto("/prices");
  await page.getByLabel("Market day").fill("2023-10-01");
  await page.getByRole("button", { name: "Check prices" }).click();
  await expect(page.getByRole("heading", { name: "Complete", exact: true })).toBeVisible();
  await expect(page.locator(".chart-plot svg")).toBeVisible();
  await page.locator("summary", { hasText: "Exact interval values" }).click();
  await expect(page.getByRole("cell", { name: "123.4567890123456789", exact: true })).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(289);
  await page.getByLabel("Market day").fill("2023-10-02");
  await page.getByRole("button", { name: "Check prices" }).click();
  await expect(page.getByRole("heading", { name: "Incomplete", exact: true })).toBeVisible();
  await page.locator("summary", { hasText: "Exact interval values" }).click();
  await expect(page.getByRole("cell", { name: "Source null", exact: true })).toBeVisible();
  await expect(page.locator('.chart-plot path[stroke="#b04a2f"][stroke-width="2"]')).toHaveCount(1);
  const plot = page.locator(".chart-plot");
  const box = (await plot.boundingBox())!;
  await page.mouse.move(box.x + 48, box.y + box.height / 2);
  await expect(plot).toContainText("interval 1/288");
  await expect(plot).toContainText("123.4567890123456789 AUD/MWh");
  await page.screenshot({ path: info.outputPath("prices.png"), fullPage: true, scale: "css" });
  await page.getByLabel("Market day").fill("2023-10-03");
  await page.getByRole("button", { name: "Check prices" }).click();
  await expect(page.getByRole("heading", { name: "Not imported", exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});
