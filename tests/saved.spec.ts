import { expect, test } from "@playwright/test";
import { coverage, day, series } from "./fixtures/prices";
import { id, job, traded } from "./fixtures/simulation";
import { openSection } from "./helpers";

test.use({ timezoneId: "Australia/Sydney" });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/prices/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("coverage?")
        ? { region: "NSW1", days: [coverage("COMPLETE")] }
        : series("COMPLETE"),
    }),
  );
});

test("a result link restores the identical saved comparison on reload", async ({ page }) => {
  let posts = 0;
  let reads = 0;
  await page.route("**/api/v1/simulations**", (route) => {
    if (route.request().method() === "POST") {
      posts++;
      return route.fulfill({ status: 202, json: job("SUCCEEDED") });
    }
    reads++;
    if (route.request().url().endsWith("/result")) return route.fulfill({ json: traded() });
    return route.fulfill({ json: job("SUCCEEDED") });
  });
  await page.goto("/batterylab");
  await page.getByLabel("Simulation day").fill(day);
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByRole("heading", { name: "Stored result ready" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`simulation=${id}$`));

  await page.reload();
  // The link restores through status/result reads alone — no resubmission.
  await expect(page.getByRole("heading", { name: "Result comparison" })).toBeVisible();
  expect(posts).toBe(1);
  expect(reads).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".result-comparison").locator(".stat-value").nth(1)).toHaveText(
    "$54.28",
  );
  // The form reflects the immutable stored inputs, not the current defaults.
  await openSection(page, "Efficiency");
  await expect(page.getByRole("radio", { name: "Separate legs" })).toBeChecked();
  await openSection(page, "Variable costs");
  await expect(page.getByLabel("Import fee (AUD/MWh)")).toHaveValue("0.5");
  await openSection(page, "Schedule windows");
  await expect(page.getByLabel("Charge end (HH:MM)", { exact: true })).toHaveValue("14:00");
  await expect(page.getByLabel("Simulation day")).toHaveValue(day);

  // Editing detaches the link so a reload cannot silently resurrect it.
  await openSection(page, "Aggregate site");
  await page.getByLabel("Capacity (MWh)", { exact: true }).fill("3");
  await expect(page).not.toHaveURL(/simulation=/);
  await expect(page.getByRole("heading", { name: "Result comparison" })).toHaveCount(0);
});

test("copy result link produces a reopenable address", async ({ page, context }) => {
  await page.route("**/api/v1/simulations**", (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({ status: 202, json: job("SUCCEEDED") });
    if (route.request().url().endsWith("/result")) return route.fulfill({ json: traded() });
    return route.fulfill({ json: job("SUCCEEDED") });
  });
  await page.goto("/batterylab");
  await page.getByLabel("Simulation day").fill(day);
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByRole("heading", { name: "Stored result ready" })).toBeVisible();

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const copy = page.getByRole("button", { name: "Copy result link" });
  await copy.focus();
  await expect(copy).toBeFocused();
  await copy.click();
  const note = await page.locator(".saved-result [role=status]").textContent();
  let link = page.url();
  if (note?.includes("copied")) {
    link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toContain(`/batterylab?simulation=${id}`);
  } else {
    expect(note).toContain(`simulation=${id}`);
  }

  // The copied address opens the same stored result in a fresh load.
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Result comparison" })).toBeVisible();
  await expect(page.locator(".result-comparison").locator(".stat-value").nth(1)).toHaveText(
    "$54.28",
  );
});

test("a link to a pending job resumes monitoring until completion", async ({ page }) => {
  let polls = 0;
  let posts = 0;
  await page.route("**/api/v1/simulations**", (route) => {
    if (route.request().method() === "POST") {
      posts++;
      return route.fulfill({ status: 202, json: job("QUEUED") });
    }
    if (route.request().url().endsWith("/result")) return route.fulfill({ json: traded() });
    polls++;
    return route.fulfill({
      headers: { "Retry-After": "1" },
      json: job(polls === 1 ? "QUEUED" : "SUCCEEDED"),
    });
  });
  await page.goto(`/batterylab?simulation=${id}`);
  await expect(page.getByText("Queued — waiting for a simulation worker.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stored result ready" })).toBeVisible({
    timeout: 10000,
  });
  expect(posts).toBe(0);
  await expect(page.getByLabel("Import fee (AUD/MWh)")).toHaveValue("0.5");
});

test("missing, failed and malformed saved links explain recovery", async ({ page }) => {
  // A malformed identifier is rejected without any request.
  await page.goto("/batterylab?simulation=not-a-simulation");
  await expect(page.getByRole("alert")).toContainText("does not identify a saved simulation");

  // An unknown identifier reports that nothing was found.
  const missing = "22222222-2222-4222-8222-222222222222";
  await page.route("**/api/v1/simulations**", (route) =>
    route.fulfill({ status: 404, json: { code: "SIMULATION_NOT_FOUND", message: "Unknown" } }),
  );
  await page.goto(`/batterylab?simulation=${missing}`);
  await expect(page.getByRole("alert")).toContainText("could not be found");

  // A failed job states the failure code and that no comparison exists.
  const failed = "33333333-3333-4333-8333-333333333333";
  await page.route("**/api/v1/simulations**", (route) =>
    route.fulfill({ json: { ...job("FAILED"), id: failed } }),
  );
  await page.goto(`/batterylab?simulation=${failed}`);
  await expect(page.getByRole("alert")).toContainText("Simulation failed");
  await expect(page.getByRole("alert")).toContainText("SIMULATION_DEADLINE_EXCEEDED");
  await expect(page.getByRole("heading", { name: "Result comparison" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run simulation" })).toBeEnabled();
});
