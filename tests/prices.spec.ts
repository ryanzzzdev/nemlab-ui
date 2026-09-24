import { expect, test } from "@playwright/test";
import { day, revision, coverage, series } from "./fixtures/prices";

for (const state of ["COMPLETE", "INCOMPLETE", "NOT_IMPORTED"] as const) {
  test(`price coverage ${state} preserves values and request boundaries`, async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "operator", value: "must-not-send", url: "http://127.0.0.1:4173" },
    ]);
    let requests = 0;
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      expect(request.method()).toBe("GET");
      expect(request.headers()["authorization"]).toBeUndefined();
      expect(request.headers()["cookie"]).toBeUndefined();
      expect(request.url()).toContain("/api/v1/prices/NSW1/");
      requests++;
      if (request.url().includes("coverage?")) {
        expect(new URL(request.url()).searchParams.get("endExclusive")).toBe("2023-10-02");
        await route.fulfill({
          json: {
            region: "NSW1",
            start: day,
            endExclusive: "2023-10-02",
            marketOffset: "+10:00",
            days: [coverage(state)],
          },
        });
      } else {
        expect(state).not.toBe("NOT_IMPORTED");
        await route.fulfill({ json: series(state as "COMPLETE" | "INCOMPLETE") });
      }
    });
    await page.goto("/batterylab");
    await page.getByLabel("Market day").fill(day);
    await page.getByRole("button", { name: "Check prices" }).click();
    if (state === "NOT_IMPORTED") {
      await expect(
        page.getByText("No stored prices for this day.", { exact: false }),
      ).toBeVisible();
      expect(requests).toBe(1);
      await expect(page.getByRole("table")).toHaveCount(0);
    } else {
      await expect(
        page.getByRole("cell", { name: "123.4567890123456789", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("cell", { name: "-25", exact: true })).toBeVisible();
      await expect(page.getByRole("row")).toHaveCount(289);
      await expect(page.getByText(`Revision: ${revision}`, { exact: false })).toBeVisible();
      await expect(page.getByRole("row").nth(1)).toContainText("00:0000:05");
      if (state === "INCOMPLETE") {
        await expect(page.getByRole("cell", { name: "Missing", exact: true })).toBeVisible();
        await expect(page.getByRole("cell", { name: "Source null", exact: true })).toBeVisible();
        await expect(page.getByText("This day has gaps", { exact: false })).toBeVisible();
      }
      expect(requests).toBe(2);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

for (const failure of ["http", "network", "html", "json"] as const) {
  test(`safe ${failure} failure and retry`, async ({ page }) => {
    await page.route("**/api/**", async (route) => {
      if (failure === "network") await route.abort();
      else if (failure === "http")
        await route.fulfill({
          status: 503,
          json: { code: "STORAGE_UNAVAILABLE", message: "internal-secret" },
        });
      else
        await route.fulfill({
          contentType: failure === "html" ? "text/html" : "application/json",
          body: failure === "html" ? "<h1>internal-secret</h1>" : "{",
        });
    });
    await page.goto("/batterylab");
    await page.getByLabel("Market day").fill(day);
    await page.getByRole("button", { name: "Check prices" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("alert")).not.toContainText("internal-secret");
    await page.unroute("**/api/**");
    await page.route("**/api/**", (route) =>
      route.fulfill({ json: { region: "NSW1", days: [coverage("NOT_IMPORTED")] } }),
    );
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Not imported", exact: true })).toBeVisible();
  });
}

test("loading and invalid dates do not display misleading results", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/**", async (route) => {
    await gate;
    await route.fulfill({ json: { region: "NSW1", days: [coverage("NOT_IMPORTED")] } });
  });
  await page.goto("/batterylab");
  await page.getByLabel("Market day").fill("2020-01-01");
  await page.getByRole("button", { name: "Check prices" }).click();
  await expect(page.getByRole("alert")).toContainText("Choose a completed NEM day");
  await page.getByLabel("Market day").fill(day);
  await page.getByRole("button", { name: "Check prices" }).click();
  await expect(
    page.getByRole("region", { name: "Explore stored prices" }).getByRole("status"),
  ).toContainText("Loading");
  release();
  await expect(page.getByRole("heading", { name: "Not imported", exact: true })).toBeVisible();
});

test("a corrected series uses its own revision and explicit recheck refreshes the cache", async ({
  page,
}) => {
  let reads = 0;
  const corrected = "00000000-0000-4000-8000-000000000002";
  await page.route("**/api/**", async (route) => {
    if (route.request().url().includes("coverage?")) {
      await route.fulfill({ json: { region: "NSW1", days: [coverage("COMPLETE")] } });
    } else {
      reads++;
      const data = series("COMPLETE");
      data.coverage.revision = corrected;
      if (reads > 1) data.intervals[0] = { ...data.intervals[0]!, state: "VALUE", price: "999.99" };
      await route.fulfill({ json: data });
    }
  });
  await page.goto("/batterylab");
  await page.getByLabel("Market day").fill(day);
  await page.getByRole("button", { name: "Check prices" }).click();
  await expect(page.getByText(`Revision: ${corrected}`, { exact: false })).toBeVisible();
  await expect(page.getByRole("cell", { name: "123.4567890123456789", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check prices" }).click();
  await expect(page.getByRole("cell", { name: "999.99", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "123.4567890123456789", exact: true })).toHaveCount(
    0,
  );
});
