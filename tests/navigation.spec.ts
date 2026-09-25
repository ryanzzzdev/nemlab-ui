import { expect, test } from "@playwright/test";

const pages = [
  { path: "/batterylab", title: "BatteryLab", heading: "What could a battery do?" },
  { path: "/prices", title: "Prices", heading: "Explore electricity prices" },
  { path: "/gridreplay", title: "GridReplay", heading: "See the story behind a market day." },
  { path: "/methodology", title: "Methodology", heading: "Understand what the numbers mean." },
];

for (const route of pages) {
  test(`direct load and reload of ${route.path}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(route.path);
    await expect(page).toHaveTitle(`${route.title} — NEMLab`);
    await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
    await expect(
      page.getByRole("navigation").getByRole("link", { name: route.title }),
    ).toHaveAttribute("aria-current", "page");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath("route.png"), fullPage: true, scale: "css" });
  });
}

test("skip link and keyboard navigation move focus to page content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();

  await page.goto("/");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "NEMLab home" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("navigation").getByRole("link", { name: "BatteryLab" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/batterylab$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await page.keyboard.press("Tab");
  // The first focusable control is the open Market day disclosure.
  await expect(page.locator("summary", { hasText: "Market day" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Simulation region", { exact: true })).toBeFocused();
  const methodology = page.getByRole("link", { name: "Read the model assumptions" });
  for (let step = 0; step < 40; step++) {
    if (await methodology.evaluate((link) => link === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(methodology).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveTitle("Methodology — NEMLab");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
});

test("navigation supports history and honest unavailable states", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Explore BatteryLab" }).click();
  await expect(page.getByRole("region", { name: "Simulation progress" })).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: "GridReplay" }).click();
  await expect(page.getByRole("heading", { name: "Replay is being built" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveTitle("BatteryLab — NEMLab");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await page.goForward();
  await expect(page).toHaveTitle("GridReplay — NEMLab");
  await expect(
    page.getByRole("navigation").getByRole("link", { name: "GridReplay" }),
  ).toHaveAttribute("aria-current", "page");
});

test("unknown paths show a recovery route", async ({ page }) => {
  await page.goto("/missing/nested/page");
  await expect(page).toHaveTitle("Page not found — NEMLab");
  await expect(page.getByRole("heading", { name: "This page isn’t here." })).toBeVisible();
  await expect(page.locator('nav [aria-current="page"]')).toHaveCount(0);
  await page.getByRole("link", { name: "Return to NEMLab home" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
});

test("navigation remains usable at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  for (const route of pages) {
    const link = page.getByRole("navigation").getByRole("link", { name: route.title });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
