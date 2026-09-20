import { expect, test } from "@playwright/test";

test("production bundle renders without browser errors at supported widths", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("NEMLab — Explore the electricity market");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "BatteryLab" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "GridReplay" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("startup.png"), fullPage: true, scale: "css" });
});
