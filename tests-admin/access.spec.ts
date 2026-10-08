import { expect, test } from "@playwright/test";
import { installApiMock } from "./helpers";

test.describe("Access workspace", () => {
  test("requests inspector approves one request with a bounded grant", async ({ page }) => {
    const calls = { mutations: [] as string[] };
    await installApiMock(page, "owner", calls);
    await page.goto("/admin/access");
    await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
    await page.locator(".table-wrap table.grid tbody tr").first().click();
    const inspector = page.locator(".inspector");
    await expect(inspector).toContainText("Fixture Applicant");
    await expect(inspector).toContainText("class project");
    await inspector.locator("button", { hasText: "Approve" }).click();
    await expect(inspector).toContainText("Approved");
    expect(
      calls.mutations.filter((m) => m === "POST /api/admin/v1/access-requests/req-1/decisions"),
    ).toHaveLength(1);
  });

  test("request tab state restores from the URL", async ({ page }) => {
    await installApiMock(page, "owner");
    await page.goto("/admin/access?tab=visitors");
    await expect(page.getByRole("tab", { name: "Visitors" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.locator(".table-wrap table.grid tbody tr").first().click();
    await expect(page.locator(".inspector")).toContainText("visitor@example.test");
    await expect(page.locator(".inspector")).toContainText("Extend");
    await expect(page.locator(".inspector")).toContainText("Revoke");
    await page.goto("/admin/access?tab=audit");
    await expect(page.locator(".table-wrap table.grid tbody")).toContainText("GRANT_CREATED");
    await page.locator(".table-wrap table.grid tbody tr").first().click();
    await expect(page.locator(".inspector")).toContainText("read-only");
  });

  test("recent-auth rejection surfaces the fresh-sign-in prompt", async ({ page }) => {
    await installApiMock(page, "owner");
    await page.route("**/api/admin/v1/access-requests/req-1/decisions", async (route) => {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ code: "RECENT_AUTH_REQUIRED", message: "re-authenticate" }),
      });
    });
    await page.goto("/admin/access");
    await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
    await page.locator(".table-wrap table.grid tbody tr").first().click();
    await page.locator(".inspector button", { hasText: "Approve" }).click();
    await expect(page.locator(".inspector")).toContainText("last 15 minutes");
  });

  test("extend and revoke go through the two-step grant flow", async ({ page }) => {
    const calls = { mutations: [] as string[] };
    await installApiMock(page, "owner", calls);
    await page.goto("/admin/access?tab=visitors");
    await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
    await page.locator(".table-wrap table.grid tbody tr").first().click();
    const inspector = page.locator(".inspector");
    await inspector.locator("button", { hasText: "Extend" }).click();
    await expect(inspector).toContainText("Extended by 30 days");
    // Revoke needs the explicit second step — no accidental action.
    await inspector.locator("button", { hasText: "Revoke…" }).click();
    await inspector.locator("input[aria-label='Revocation reason']").fill("no longer needed");
    await inspector.locator("button", { hasText: "Confirm revoke" }).click();
    await expect(inspector).toContainText("Access revoked");
    expect(calls.mutations.filter((m) => m.endsWith("/extend"))).toHaveLength(1);
    expect(calls.mutations.filter((m) => m.endsWith("/revoke"))).toHaveLength(1);
  });
});
