import { expect, test } from "@playwright/test";
import { installApiMock } from "./helpers";

test.describe("auth and entry", () => {
  test("anonymous visitors land on welcome with both entry paths", async ({ page }) => {
    await installApiMock(page, "anonymous");
    await page.goto("/admin/");
    await expect(page).toHaveURL(/welcome/);
    await expect(page.locator("h1")).toContainText("Inspect and manage NEMLab data");
    await expect(page.locator("a", { hasText: "Go to sign in" })).toBeVisible();
    await expect(page.locator("a", { hasText: "Request access" })).toBeVisible();
  });

  test("auth pages hold at phone widths without horizontal scroll", async ({ page }) => {
    await installApiMock(page, "anonymous");
    for (const path of ["/admin/welcome", "/admin/sign-in", "/admin/request-access"]) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path);
      await page.locator("h1, .card").first().waitFor();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows at 390px`).toBe(0);
    }
  });

  test("help drawer opens from the appbar and carries session context", async ({ page }) => {
    await installApiMock(page, "owner");
    await page.goto("/admin/");
    await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
    await page.locator(".appbar button", { hasText: "Help" }).click();
    const drawer = page.locator(".drawer");
    await expect(drawer).toContainText("How the console works");
    await expect(drawer).toContainText("owner access");
    await expect(drawer).toContainText("Baseline readiness");
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    // Focus returns to the opener.
    await expect(page.locator(".appbar button", { hasText: "Help" })).toBeFocused();
  });

  test("an expired session lands back on welcome", async ({ page }) => {
    await installApiMock(page, "owner");
    await page.goto("/admin/");
    await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
    // The next session read reports unauthenticated — the app returns to welcome.
    await page.unroute("**/api/auth/v1/session");
    await page.route("**/api/auth/v1/session", async (route) => {
      await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    });
    await page.reload();
    await expect(page).toHaveURL(/welcome/);
  });
});
