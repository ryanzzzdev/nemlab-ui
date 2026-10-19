import { expect, test } from "@playwright/test";
import { SIMULATIONS_PAGE, installApiMock, ownerPage } from "./helpers";

test.describe("Simulations catalogue", () => {
  test("stored simulations list with status chips and scope counts", async ({ page }) => {
    await ownerPage(page);
    await page.locator(".tab", { hasText: "Simulations" }).click();
    await expect(page).toHaveURL(/view=simulations/);
    const rows = page.locator(".table-wrap table.grid tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText("2023-09-01");
    await expect(rows.first()).toContainText("Fixed · Threshold · Hindsight");
    await expect(page.locator(".strip")).toContainText("Running");
    await expect(page.locator(".strip")).toContainText("Failed");
  });

  test("status, strategy and sort filters persist in the URL", async ({ page }) => {
    const calls = { mutations: [] };
    await installApiMock(page, "owner", calls);
    const requests: string[] = [];
    await page.route("**/api/admin/v1/simulations?*", async (route) => {
      requests.push(route.request().url());
      await route.fallback();
    });
    await page.goto("/admin/");
    await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
    await page.locator(".tab", { hasText: "Simulations" }).click();
    await page.locator(".tab", { hasText: "Failed" }).click();
    await expect(page).toHaveURL(/status=FAILED/);
    const rows = page.locator(".table-wrap table.grid tbody tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("solver timeout");
    await page.locator(".toolbar-row select").first().selectOption("threshold");
    await expect(page).toHaveURL(/strategy=threshold/);
    await expect(page.locator(".table-wrap")).toContainText("No stored simulations");
    await page.locator(".toolbar-row select").last().selectOption("oldest");
    await expect(page).toHaveURL(/sort=oldest/);
    // The API saw the real filter — the UI isn't filtering client-side.
    expect(requests.some((u) => u.includes("status=FAILED"))).toBe(true);
    // Back restores the pre-sort state — filters are URL state, not local.
    await page.goBack();
    await expect(page).not.toHaveURL(/sort=/);
  });

  test("selecting a row opens the detail inspector with lifecycle and provenance", async ({
    page,
  }) => {
    await ownerPage(page);
    await page.locator(".tab", { hasText: "Simulations" }).click();
    await page.locator(".table-wrap table.grid tbody tr").first().click();
    await expect(page).toHaveURL(/sel=simulation(%3A|:)/);
    const inspector = page.locator(".inspector");
    await expect(inspector).toContainText("NSW1 2023-09-01");
    await expect(inspector).toContainText("2 MWh");
    await expect(inspector).toContainText("OPTIMAL");
    await expect(inspector).toContainText("573.60");
    await expect(inspector).toContainText("Claimed attempt 1");
    await expect(inspector).toContainText("Pinned revision is current");
    await expect(inspector.locator("a", { hasText: "Open in BatteryLab" })).toHaveAttribute(
      "target",
      "_blank",
    );
  });

  test("a pre-capture job shows 'not recorded' instead of invented history", async ({ page }) => {
    await ownerPage(page);
    await page.locator(".tab", { hasText: "Simulations" }).click();
    await page.locator(".table-wrap table.grid tbody tr:has-text('2023-09-03')").click();
    const inspector = page.locator(".inspector");
    await expect(inspector).toContainText("Failed");
    await expect(inspector).toContainText("history was not recorded");
    await expect(inspector).toContainText("No stored result");
  });

  test("a day selection links into a scoped simulations view", async ({ page }) => {
    await ownerPage(page);
    await page.locator(".table-wrap table.grid tbody tr:has-text('2023-09-01')").click();
    await page.locator(".inspector button", { hasText: "View simulations for this day" }).click();
    await expect(page).toHaveURL(/view=simulations/);
    await expect(page).toHaveURL(/from=2023-09-01/);
    await expect(page).toHaveURL(/to=2023-09-01/);
    // The mock honours the day scope — only the 2023-09-01 row remains.
    await expect(page.locator(".table-wrap table.grid tbody tr")).toHaveCount(1);
  });

  test("selecting a simulation swaps the activity pane to its lifecycle", async ({ page }) => {
    await ownerPage(page);
    await page.locator(".tab", { hasText: "Simulations" }).click();
    await page.getByRole("checkbox", { name: "All recent" }).check();
    await expect(page.locator(".activity-body")).toContainText("Load operation");
    await page.locator(".table-wrap table.grid tbody tr").first().click();
    const activity = page.locator(".activity-body");
    await expect(activity).toContainText("simulation 11111111");
    await expect(activity).toContainText("Claimed attempt 1");
  });

  test("a direct simulation ID outside the scope keeps its inspector", async ({ page }) => {
    const calls = { mutations: [] };
    await installApiMock(page, "owner", calls);
    await page.goto(`/admin/?view=simulations&sel=simulation:${SIMULATIONS_PAGE.rows[0]!.id}`);
    const inspector = page.locator(".inspector");
    await expect(inspector).toContainText("Outside this selection");
    await expect(inspector).toContainText("NSW1 2023-09-01");
  });
});
