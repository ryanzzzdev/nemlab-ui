import { expect, test } from "@playwright/test";
import { installApiMock, ownerPage, viewerPage } from "./helpers";

test.describe("DataOps workspace", () => {
  test("coverage rows select into the inspector with exact series detail", async ({ page }) => {
    await ownerPage(page);
    await expect(page.locator(".toolbar h1")).toHaveText("Data Operations");
    await expect(page.locator(".strip")).toContainText("1/3");
    await page.locator(".table-wrap table.grid tbody tr:has-text('2023-09-01')").click();
    await expect(page.locator(".inspector")).toContainText("2023-09-01");
    await expect(page.locator(".inspector")).toContainText("288 valid");
    await expect(page.locator(".inspector")).toContainText("Ramp baseline");
    await expect(page.locator(".inspector")).toContainText("Ready");
  });

  test("applied scope lives in the URL; draft edits do not query until Apply", async ({ page }) => {
    await ownerPage(page);
    await page.locator(".toolbar input[type=date]").first().fill("2023-09-02");
    await page.locator(".toolbar input[type=date]").last().fill("2023-09-04");
    // Draft only — the URL still carries the applied scope.
    expect(page.url()).not.toContain("from=2023-09-02");
    await page.locator(".toolbar button", { hasText: "Apply" }).click();
    await expect(page).toHaveURL(/from=2023-09-02/);
    await expect(page).toHaveURL(/to=2023-09-04/);
  });

  test("a scope over 31 days is rejected before any request", async ({ page }) => {
    const calls = { mutations: [] as string[] };
    await installApiMock(page, "owner", calls);
    let coverageCalls = 0;
    await page.route("**/api/admin/v1/grid-coverage/**", async (route) => {
      coverageCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          region: "NSW1",
          start: "x",
          endExclusive: "y",
          marketOffset: "+10:00",
          days: [{ day: "2023-09-01", availability: "COMPLETE", series: [] }],
        }),
      });
    });
    await page.goto("/admin/");
    await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
    coverageCalls = 0;
    await page.locator(".toolbar input[type=date]").first().fill("2023-01-01");
    await page.locator(".toolbar input[type=date]").last().fill("2023-04-01");
    await page.locator(".toolbar button", { hasText: "Apply" }).click();
    await expect(page.locator(".banner")).toContainText("31 days");
    expect(coverageCalls).toBe(0);
  });

  test("tabs switch linked views and selection follows the view", async ({ page }) => {
    await ownerPage(page);
    await page.locator(".tab", { hasText: "Loads & Jobs" }).click();
    await expect(page).toHaveURL(/view=jobs/);
    await expect(page.locator(".table-wrap table.grid tbody")).toContainText("Load operation");
    await expect(page.locator(".table-wrap table.grid tbody")).toContainText("Grid import");
    await expect(page.locator(".table-wrap table.grid tbody")).toContainText("Price refresh");
    await page.locator(".table-wrap table.grid tbody tr").first().click();
    await expect(page.locator(".inspector")).toContainText("Phase");
    await page.locator(".tab", { hasText: "Publications" }).click();
    await expect(page).toHaveURL(/view=publications/);
    await expect(page.locator(".table-wrap table.grid tbody")).toContainText("Current");
    // A jobs selection cannot follow into publications — inspector resets.
    await expect(page.locator(".inspector")).toHaveCount(0);
  });

  test("activity pane selection switches view and selection atomically", async ({ page }) => {
    await ownerPage(page);
    await page.getByRole("checkbox", { name: "All recent" }).check();
    await page.locator(".activity-body tbody tr").first().click();
    await expect(page).toHaveURL(/view=jobs/);
    await expect(page).toHaveURL(/sel=/);
    await expect(page.locator(".inspector")).not.toContainText("Select a row");
  });

  test("split handles resize the inspector and activity panes", async ({ page }) => {
    await ownerPage(page);
    await page.locator(".table-wrap tbody tr").first().click();
    const vHandle = (await page.locator(".split-handle.v").boundingBox())!;
    const before = await page
      .locator(".inspector")
      .evaluate((el) => el.getBoundingClientRect().width);
    await page.mouse.move(vHandle.x + 2, vHandle.y + vHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(vHandle.x - 100, vHandle.y + vHandle.height / 2, { steps: 5 });
    await page.mouse.up();
    const after = await page
      .locator(".inspector")
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(after - before).toBeGreaterThan(80); // ~100px drag, allow rounding

    const hHandle = (await page.locator(".split-handle.h").boundingBox())!;
    const hBefore = await page
      .locator(".activity")
      .evaluate((el) => el.getBoundingClientRect().height);
    await page.mouse.move(hHandle.x + hHandle.width / 2, hHandle.y + 2);
    await page.mouse.down();
    await page.mouse.move(hHandle.x + hHandle.width / 2, hHandle.y - 60, { steps: 5 });
    await page.mouse.up();
    const hAfter = await page
      .locator(".activity")
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(hAfter - hBefore).toBeGreaterThan(40);
  });

  test("back and forward restore view, scope and selection", async ({ page }) => {
    await ownerPage(page);
    await page.locator(".tab", { hasText: "Loads & Jobs" }).click();
    await page.locator(".table-wrap table.grid tbody tr").first().click();
    await expect(page).toHaveURL(/view=jobs.*sel=|sel=.*view=jobs/);
    await page.goBack();
    await page.goBack();
    await expect(page).toHaveURL(/view=coverage|admin\/(\?.*)?$/);
    await page.goForward();
    await expect(page).toHaveURL(/view=jobs/);
  });

  test("invalid params recover to the workspace without mutating", async ({ page }) => {
    const calls = { mutations: [] as string[] };
    await installApiMock(page, "owner", calls);
    await page.goto("/admin/?view=bogus&sel=zzz&region=MARS&from=not-a-date");
    await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
    await expect(page.locator(".toolbar h1")).toHaveText("Data Operations");
    expect(calls.mutations).toEqual([]);
  });

  test("legacy paths redirect into the canonical workspace URL", async ({ page }) => {
    await installApiMock(page, "owner");
    await page.goto("/admin/jobs");
    await expect(page).toHaveURL(/view=jobs/);
    await page.goto("/admin/publications");
    await expect(page).toHaveURL(/view=publications/);
    await page.goto("/admin/load?region=SA1&start=2023-08-01&end=2023-08-05");
    await expect(page).toHaveURL(/view=jobs/);
    await expect(page).toHaveURL(/region=SA1/);
    await expect(page).toHaveURL(/from=2023-08-01/);
    await expect(page).toHaveURL(/to=2023-08-05/);
    await page.goto("/admin/how-it-works");
    await expect(page).toHaveURL(/help=1/);
    await expect(page.locator(".drawer")).toBeVisible();
    await expect(page.locator(".drawer")).toContainText("The four steps");
  });
});

test.describe("owner drawers", () => {
  test("load drawer captures scope, reviews and starts once", async ({ page }) => {
    const calls = { mutations: [] as string[] };
    await installApiMock(page, "owner", calls);
    await page.goto("/admin/");
    await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
    await page.locator(".toolbar button", { hasText: "Load data" }).click();
    const drawer = page.locator(".drawer");
    await expect(drawer).toContainText("One operation loads grid observations");
    await drawer.locator("button", { hasText: "Review scope" }).click();
    await expect(drawer).toContainText("Start loading");
    await drawer.locator("button", { hasText: "Start loading" }).click();
    await expect(drawer).toContainText("Load operation created");
    expect(calls.mutations.filter((m) => m === "POST /api/admin/v1/load-operations")).toHaveLength(
      1,
    );
    await page.keyboard.press("Escape");
    await expect(page.locator(".drawer")).toHaveCount(0);
    // Reopening shows the draft, never replays the submission.
    await page.locator(".toolbar button", { hasText: "Load data" }).click();
    await expect(page.locator(".drawer")).toBeVisible();
    expect(calls.mutations.filter((m) => m === "POST /api/admin/v1/load-operations")).toHaveLength(
      1,
    );
  });

  test("publish drawer checks coverage then posts an explicit v2 attempt", async ({ page }) => {
    const calls = { mutations: [] as string[] };
    await installApiMock(page, "owner", calls);
    await page.goto("/admin/");
    await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
    await page.locator(".toolbar button", { hasText: "Review & publish" }).click();
    const drawer = page.locator(".drawer");
    await drawer.locator("button", { hasText: "Check coverage" }).click();
    // Fixture has gap days — publish stays locked until acknowledged.
    await expect(drawer).toContainText("lack complete required grid data");
    await expect(drawer.locator("button", { hasText: "Detect & publish" })).toBeDisabled();
    await drawer.locator(".ack input").check();
    await drawer.locator("button", { hasText: "Detect & publish v2" }).click();
    await expect(drawer).toContainText("events under v2");
    expect(
      calls.mutations.filter((m) => m === "POST /api/admin/v1/grid-publications"),
    ).toHaveLength(1);
  });
});

test.describe("price readiness", () => {
  test("coverage rows carry the shared price state for the scoped days", async ({ page }) => {
    await ownerPage(page);
    const rows = page.locator(".table-wrap table.grid tbody tr");
    await expect(rows.filter({ hasText: "2023-09-01" })).toContainText("Complete");
    await expect(rows.filter({ hasText: "2023-09-02" })).toContainText("Partial");
    await expect(rows.filter({ hasText: "2023-09-03" })).toContainText("Not imported");
  });

  test("the day inspector shows price readiness and related simulations", async ({ page }) => {
    await ownerPage(page);
    await page.locator(".table-wrap table.grid tbody tr:has-text('2023-09-01')").click();
    const inspector = page.locator(".inspector");
    await expect(inspector).toContainText("Price readiness");
    await expect(inspector).toContainText("288 valid");
    await expect(inspector).toContainText("Current revision");
    await expect(inspector).toContainText("Simulations for this day");
    await expect(inspector).toContainText("fixed, threshold, hindsight");
    // Clicking a stored simulation opens its inspector in place.
    await inspector.locator(".data-table tbody tr").first().click();
    await expect(page).toHaveURL(/sel=simulation(%3A|:)/);
    await expect(inspector).toContainText("Provenance");
  });

  test("owner refreshes prices through the protected endpoint; pinned results are untouched", async ({
    page,
  }) => {
    const calls = { mutations: [] as string[] };
    await installApiMock(page, "owner", calls);
    await page.goto("/admin/");
    await page.locator(".table-wrap table.grid tbody tr:has-text('2023-09-02')").click();
    await page.locator(".inspector button", { hasText: "Refresh prices" }).click();
    await expect(page.locator(".inspector .banner")).toContainText("Price refresh queued");
    expect(calls.mutations).toContain("POST /api/admin/v1/price-refreshes");
  });

  test("viewer sees readiness but no refresh control", async ({ page }) => {
    await viewerPage(page);
    await page.locator(".table-wrap table.grid tbody tr").first().click();
    const inspector = page.locator(".inspector");
    await expect(inspector).toContainText("Price readiness");
    await expect(inspector.locator("button", { hasText: "Refresh prices" })).toHaveCount(0);
    await expect(inspector).toContainText("owner actions");
  });
});

test.describe("viewer boundary", () => {
  test("viewer gets read-only workspace and no access surface", async ({ page }) => {
    await viewerPage(page);
    await expect(page.locator(".account .sub")).toContainText("read-only");
    await expect(page.locator(".toolbar button", { hasText: "Load data" })).toHaveCount(0);
    await expect(page.locator(".rail-item", { hasText: "Access" })).toHaveCount(0);
    await page.locator(".table-wrap table.grid tbody tr").first().click();
    await expect(page.locator(".inspector")).toContainText(
      "Loading data and price refreshes are owner actions",
    );
    await page.goto("/admin/access");
    await expect(page.locator("#workspace")).toContainText("owner actions");
  });
});

test("inspector uses space only when selected and returns keyboard focus on close", async ({
  page,
}) => {
  await ownerPage(page);
  await expect(page.locator(".inspector")).toHaveCount(0);
  const grid = page.locator(".table-wrap table[role=grid]");
  const fullWidth = await grid.evaluate((el) => el.getBoundingClientRect().width);
  await grid.locator("tbody tr").first().click();
  await expect(page.locator(".inspector")).toBeVisible();
  expect(await grid.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(fullWidth);
  await page.getByRole("button", { name: "Close inspector" }).click();
  await expect(page.locator(".inspector")).toHaveCount(0);
  await expect(grid).toBeFocused();
  await expect(page).not.toHaveURL(/sel=/);
});

test("activity respects market dates and All recent deliberately widens them", async ({ page }) => {
  await ownerPage(page);
  await page.getByLabel("From", { exact: true }).fill("2023-09-01");
  await page.getByLabel("To", { exact: true }).fill("2023-09-03");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".activity")).toContainText("2023-09-01");
  await expect(page.locator(".activity")).not.toContainText("2023-08-01");
  await page.getByRole("checkbox", { name: "All recent" }).check();
  await expect(page.locator(".activity")).toContainText("2023-08-01");
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole("link", { name: "Data Ops", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Access", exact: true })).toBeVisible();
});
