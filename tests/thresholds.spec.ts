import { expect, test } from "@playwright/test";
import { coverage, day, series } from "./fixtures/prices";
import { id, job, thresholded, traded } from "./fixtures/simulation";

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
    if (route.request().url().endsWith("/result")) return route.fulfill({ json: thresholded() });
    return route.fulfill({ json: job("SUCCEEDED") });
  });
  await page.goto("/batterylab");
  await page.getByLabel("Simulation day").fill(day);
});

async function enable(page: import("@playwright/test").Page) {
  await page.getByRole("checkbox", { name: "Run the threshold experiment" }).check();
}

test("threshold inputs validate order, signed decimals and exponent notation", async ({ page }) => {
  const charge = page.getByLabel("Charge below (AUD/MWh)");
  const discharge = page.getByLabel("Discharge above (AUD/MWh)");
  // Both fields stay hidden and optional until the experiment is enabled.
  await expect(charge).toHaveCount(0);
  let posted: string | null = null;
  await page.route("**/api/v1/simulations", async (route) => {
    posted = route.request().postData();
    await route.fulfill({ status: 202, json: job("SUCCEEDED") });
  });
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByRole("heading", { name: "Stored result ready" })).toBeVisible();
  expect(posted).not.toContain("thresholds");

  await enable(page);
  // Equal thresholds violate the strict ordering rule.
  await charge.fill("50");
  await discharge.fill("50");
  await page.getByRole("button", { name: "Run simulation" }).click();
  const chargeError = page.locator("#error-chargeBelow");
  await expect(chargeError).toContainText("must be below the discharge threshold");
  await expect(charge).toBeFocused();
  // Exponent notation is rejected like every other decimal input.
  await charge.fill("1e2");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(chargeError).toContainText("negative values allowed");
  // Signed decimals pass, preserving the exact strings in the request.
  await charge.fill("-5.5");
  await discharge.fill("50");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByRole("heading", { name: "Stored result ready" })).toBeVisible();
  expect(JSON.parse(posted!)).toMatchObject({
    thresholds: { chargeBelow: "-5.5", dischargeAbove: "50" },
  });
});

test("threshold result adds a stat card, breakdown column, series and readout action", async ({
  page,
}, info) => {
  await enable(page);
  await page.getByLabel("Charge below (AUD/MWh)").fill("-5");
  await page.getByLabel("Discharge above (AUD/MWh)").fill("50");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByRole("heading", { name: "Stored result ready" })).toBeVisible();
  const comparison = page.locator(".result-comparison");
  // Fifth stat card identifies all-day operation and the unequal ending energy.
  const card = comparison.locator(".stat").filter({ hasText: "Threshold rule margin" });
  await expect(card.locator(".stat-value")).toHaveText(/^\$|^\-\$/);
  await expect(card).toContainText("all-day");
  await expect(card).toContainText("ends 0.000 MWh");
  await expect(comparison).toContainText("not a like-for-like comparison");
  // The financial breakdown gains a Threshold rule column.
  const breakdown = comparison.getByRole("table").first();
  await expect(breakdown.getByRole("columnheader", { name: "Threshold rule" })).toBeVisible();
  // The power panel offers the third strategy; legends name the threshold series.
  const seg = page.getByRole("button", { name: "Threshold", exact: true });
  await expect(seg).toBeVisible();
  await seg.click();
  await expect(seg).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".sw-threshold")).toHaveCount(2);
  // Labelled dashed threshold lines mark the two levels on the price panel.
  const pricePanel = page.locator(".chart-plot").first();
  await expect(pricePanel).toContainText("Charge < -5");
  await expect(pricePanel).toContainText("Discharge > 50");
  // The readout explains the rule's action at the selected interval.
  const readout = comparison.locator(".chart-readout");
  await expect(readout).toContainText("Threshold:");
  // Interval 0 is above the discharge threshold but the battery starts empty.
  await expect(readout).toContainText("Hold: already empty");
  const range = page.getByRole("slider", { name: "Selected interval" });
  await range.evaluate((el: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, "160");
  await expect(readout).toContainText("Charge: below threshold (power limit)");
  await range.evaluate((el: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, "100");
  await expect(readout).toContainText("Hold: price between thresholds");
  // The exact table carries the threshold columns and the methodology caveat.
  await page.locator("summary", { hasText: "Interval detail" }).click();
  const intervals = comparison.getByRole("table").last();
  await expect(intervals.getByRole("columnheader", { name: "Threshold MW" }).first()).toBeVisible();
  await page.locator("summary", { hasText: "Methodology and scope" }).click();
  await expect(comparison).toContainText("idealised same-interval replay");
  await page.screenshot({ path: info.outputPath("result-threshold.png"), fullPage: true });
  // The threshold series and price lines stay legible in the dark theme.
  await page.getByRole("combobox", { name: "Appearance" }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(pricePanel.locator("svg")).toBeVisible();
  await expect(pricePanel).toContainText("Discharge > 50");
  await page.screenshot({ path: info.outputPath("result-threshold-dark.png"), fullPage: true });
});

test("a saved threshold link restores the experiment inputs", async ({ page }) => {
  await page.goto(`/batterylab?simulation=${id}`);
  await expect(page.getByRole("heading", { name: "Stored result ready" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Run the threshold experiment" })).toBeChecked();
  await expect(page.getByLabel("Charge below (AUD/MWh)")).toHaveValue("-5");
  await expect(page.getByLabel("Discharge above (AUD/MWh)")).toHaveValue("50");
  await expect(page.locator(".result-comparison")).toContainText("Threshold rule");
});

test("a saved result stored before the experiment still renders", async ({ page }) => {
  // Old stored JSON has no threshold key at all — not even null.
  const old = traded() as unknown as Record<string, unknown>;
  delete old["threshold"];
  await page.unroute("**/api/v1/simulations**");
  await page.route("**/api/v1/simulations**", (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({ status: 202, json: job("SUCCEEDED") });
    if (route.request().url().endsWith("/result")) return route.fulfill({ json: old });
    return route.fulfill({ json: job("SUCCEEDED") });
  });
  await page.goto(`/batterylab?simulation=${id}`);
  await expect(page.getByRole("heading", { name: "Stored result ready" })).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Run the threshold experiment" }),
  ).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Threshold", exact: true })).toHaveCount(0);
  await expect(page.locator(".result-comparison")).not.toContainText("Threshold rule");
});
