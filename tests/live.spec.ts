import { expect, test } from "@playwright/test";

test("submits a real simulation and retrieves a worker-produced result", async ({ page }, info) => {
  await page.goto("/batterylab");
  await page.getByLabel("Simulation day").fill("2023-10-01");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByRole("heading", { name: "Stored result ready" })).toBeVisible({
    timeout: 25000,
  });
  const first = await page.locator(".simulation-status .revision").first().textContent();
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByRole("heading", { name: "Stored result ready" })).toBeVisible();
  await expect(page.locator(".simulation-status .revision").first()).toHaveText(first!);
  await page.screenshot({
    path: info.outputPath("live-simulation.png"),
    fullPage: true,
    scale: "css",
  });
});

test("reads complete, incomplete and absent days through the real API proxy", async ({
  page,
}, info) => {
  await page.goto("/batterylab");
  await page.getByLabel("Market day").fill("2023-10-01");
  await page.getByRole("button", { name: "Check prices" }).click();
  await expect(page.getByRole("heading", { name: "Complete", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "123.4567890123456789", exact: true })).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(289);
  await page.getByLabel("Market day").fill("2023-10-02");
  await page.getByRole("button", { name: "Check prices" }).click();
  await expect(page.getByRole("heading", { name: "Incomplete", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Source null", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show chart prototype" }).click();
  await expect(page.locator('.linked-chart path[stroke="#b04a2f"]')).toHaveCount(2);
  await expect(page.locator(".chart-readout")).toContainText("123.4567890123456789 AUD/MWh");
  await page.screenshot({ path: info.outputPath("prices.png"), fullPage: true, scale: "css" });
  await page.getByLabel("Market day").fill("2023-10-03");
  await page.getByRole("button", { name: "Check prices" }).click();
  await expect(page.getByRole("heading", { name: "Not imported", exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});
