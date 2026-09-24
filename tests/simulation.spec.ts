import { expect, test } from "@playwright/test";
import { coverage, day, series } from "./fixtures/prices";
import { id, job, result } from "./fixtures/simulation";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/prices/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("coverage?")
        ? { region: "NSW1", days: [coverage("COMPLETE")] }
        : series("COMPLETE"),
    }),
  );
  await page.goto("/batterylab");
  await page.getByLabel("Simulation day").fill(day);
});

test("submits exact inputs once, polls progress and retrieves the stored result", async ({
  page,
}, info) => {
  let submissions = 0;
  let polls = 0;
  await page
    .context()
    .addCookies([{ name: "operator", value: "must-not-send", url: "http://127.0.0.1:4173" }]);
  await page.route("**/api/v1/simulations**", async (route) => {
    expect(route.request().headers()["cookie"]).toBeUndefined();
    expect(route.request().headers()["authorization"]).toBeUndefined();
    if (route.request().method() === "POST") {
      submissions++;
      const body = route.request().postDataJSON();
      expect(body.site.capacityMWh).toBe("2.000000000000000001");
      expect(body.efficiency).toEqual({ roundTrip: "0.9" });
      expect(body.windows.dischargeEnd).toBe(1440);
      return route.fulfill({ status: 202, headers: { "Retry-After": "1" }, json: job("QUEUED") });
    }
    if (route.request().url().endsWith("/result")) return route.fulfill({ json: result() });
    polls++;
    return route.fulfill({
      headers: { "Retry-After": "1" },
      json: job(polls === 1 ? "RUNNING" : "SUCCEEDED"),
    });
  });
  await page.getByLabel("Capacity (MWh)", { exact: true }).fill("2.000000000000000001");
  await page.getByLabel("Discharge end").fill("24:00");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByText("Queued — waiting", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run simulation" })).toBeDisabled();
  await expect(page.getByLabel("Capacity (MWh)", { exact: true })).toBeDisabled();
  await expect(page.getByText("Running — comparing", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stored result ready" })).toBeVisible();
  expect(submissions).toBe(1);
  expect(polls).toBe(2);
  await page.screenshot({
    path: info.outputPath("simulation-complete.png"),
    fullPage: true,
    scale: "css",
  });
  await page.getByLabel("Charge power (MW)", { exact: true }).fill("0.5");
  await expect(page.getByRole("heading", { name: "Stored result ready" })).toHaveCount(0);
  await expect(page.getByText(`Simulation: ${id}`, { exact: false })).toHaveCount(0);
});

test("validates exact energy bounds, decimals, efficiency and ordered windows without requests", async ({
  page,
}) => {
  let requests = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/")) requests++;
  });
  await page.getByLabel("Initial energy").fill("2.000000000000000001");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByLabel("Initial energy")).toBeFocused();
  await expect(page.getByLabel("Initial energy")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Initial energy").fill("0");
  await page.getByLabel("Round-trip efficiency").fill("0.00001");
  await page.getByLabel("Charge start (HH:MM)", { exact: true }).fill("10:01");
  await page.getByLabel("Capacity (MWh)", { exact: true }).fill("1e3");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByLabel("Capacity (MWh)", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByLabel("Round-trip efficiency")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Charge start (HH:MM)", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByLabel("Capacity (MWh)", { exact: true }).fill("2");
  await page.getByLabel("Round-trip efficiency").fill("0.9");
  await page.getByLabel("Charge start (HH:MM)", { exact: true }).fill("18:00");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByText("Use one nonempty charge window", { exact: false })).toBeVisible();
  expect(requests).toBe(0);
});

test("an uncovered day requests a price fetch then submits when coverage arrives", async ({
  page,
}) => {
  let posts = 0;
  await page.route("**/api/v1/simulations**", (route) => {
    if (route.request().method() === "POST") {
      posts++;
      if (posts < 3)
        return route.fulfill({
          status: 409,
          headers: { "Retry-After": "1" },
          json: {
            code: "PRICE_REFRESH_PENDING",
            field: "day",
            reason: "PRICE_REFRESH_PENDING",
          },
        });
      return route.fulfill({
        status: 202,
        headers: { "Retry-After": "1" },
        json: job("SUCCEEDED"),
      });
    }
    if (route.request().url().endsWith("/result")) return route.fulfill({ json: result() });
    return route.fulfill({ json: job("SUCCEEDED") });
  });
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByText("Fetching stored prices")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stored result ready" })).toBeVisible({
    timeout: 15000,
  });
  expect(posts).toBe(3);
});

test("a failed visitor fetch and an exhausted visitor cap stop automatic resubmission", async ({
  page,
}) => {
  let posts = 0;
  await page.route("**/api/v1/simulations", (route) => {
    posts++;
    return route.fulfill({
      status: 409,
      headers: { "Retry-After": "1" },
      json:
        posts === 1
          ? { code: "PRICE_REFRESH_PENDING", field: "day", reason: "PRICE_REFRESH_PENDING" }
          : { code: "PRICE_REFRESH_FAILED", field: "day", reason: "PRICE_REFRESH_FAILED" },
    });
  });
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByRole("alert")).toContainText("could not be fetched");
  await expect(page.getByLabel("Simulation day")).toHaveAttribute("aria-invalid", "true");
  expect(posts).toBe(2);
});

test("a saturated visitor queue retries briefly then pauses", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/v1/simulations", (route) => {
    posts++;
    return route.fulfill({
      status: 429,
      headers: { "Retry-After": "1" },
      json: { code: "VISITOR_REFRESH_LIMIT", field: "request", reason: "VISITOR_REFRESH_LIMIT" },
    });
  });
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByText("retrying automatically")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("still queued", { timeout: 20000 });
  expect(posts).toBe(11);
});

test("separate efficiencies omit round trip and terminal duplicates do not restart failures", async ({
  page,
}) => {
  let posts = 0;
  await page.route("**/api/v1/simulations", (route) => {
    posts++;
    expect(route.request().postDataJSON().efficiency).toEqual({
      charge: "0.95",
      discharge: "0.95",
    });
    return route.fulfill({ json: job("FAILED") });
  });
  await page.getByLabel("Efficiency input").selectOption("legs");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByRole("alert")).toContainText("does not restart it");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByRole("alert")).toContainText("does not restart it");
  expect(posts).toBe(2);
});

for (const [code, status, message] of [
  ["QUEUE_FULL", 429, "Try after 5 seconds"],
  ["STORAGE_UNAVAILABLE", 503, "temporarily unavailable"],
  ["PRICE_REFRESH_FAILED", 409, "could not be fetched"],
] as const) {
  test(`safe ${code} response without automatic resubmission`, async ({ page }) => {
    let posts = 0;
    await page.route("**/api/v1/simulations", (route) => {
      posts++;
      return route.fulfill({
        status,
        headers: { "Retry-After": "5" },
        json: { code, message: "internal diagnostic must not render" },
      });
    });
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByRole("alert")).toContainText(message);
    await expect(page.getByText("internal diagnostic must not render")).toHaveCount(0);
    expect(posts).toBe(1);
  });
}

test("server field errors focus the rejected input", async ({ page }) => {
  await page.route("**/api/v1/simulations", (route) =>
    route.fulfill({
      status: 400,
      json: { code: "INVALID_REQUEST", field: "site.capacityMWh", reason: "OUT_OF_RANGE" },
    }),
  );
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByLabel("Capacity (MWh)", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Capacity (MWh)", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("stop and resume retains the job, and navigation aborts pending polling", async ({ page }) => {
  let posts = 0;
  let polls = 0;
  await page.route("**/api/v1/simulations**", (route) => {
    if (route.request().method() === "POST") posts++;
    else polls++;
    return route.fulfill({ headers: { "Retry-After": "30" }, json: job("QUEUED") });
  });
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByText("Queued — waiting", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Stop checking" }).click();
  await expect(page.getByRole("status")).toContainText("backend job continues");
  await page.getByRole("button", { name: "Resume checking" }).click();
  await expect(page.getByText("Queued — waiting", { exact: false })).toBeVisible();
  expect(posts).toBe(1);
  expect(polls).toBe(1);
  await page.getByRole("navigation").getByRole("link", { name: "GridReplay" }).click();
  await page.getByRole("navigation").getByRole("link", { name: "BatteryLab" }).click();
  await expect(page.getByText(`Simulation: ${id}`, { exact: false })).toHaveCount(0);
});

test("an interrupted status request resumes the same job and rejects invalid results", async ({
  page,
}) => {
  let posts = 0;
  let polls = 0;
  await page.route("**/api/v1/simulations**", (route) => {
    if (route.request().method() === "POST") {
      posts++;
      return route.fulfill({ status: 202, headers: { "Retry-After": "1" }, json: job("QUEUED") });
    }
    if (route.request().url().endsWith("/result"))
      return route.fulfill({ json: { ...result(), prices: [] } });
    polls++;
    return polls === 1 ? route.abort() : route.fulfill({ json: job("SUCCEEDED") });
  });
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not reach");
  await page.getByRole("button", { name: "Resume checking" }).click();
  await expect(page.getByRole("alert")).toContainText("invalid result");
  await expect(page.getByRole("heading", { name: "Stored result ready" })).toHaveCount(0);
  expect(posts).toBe(1);
});
