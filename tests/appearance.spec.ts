import { expect, test } from "@playwright/test";
import { coverage, day, series } from "./fixtures/prices";

test("appearance follows the device, persists overrides and restores auto", async ({
  page,
}, info) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/batterylab");
  const picker = page.getByRole("combobox", { name: "Appearance" });
  const background = () =>
    page.locator("html").evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect(picker).toHaveValue("auto");
  const otherPage = await page.context().newPage();
  await otherPage.goto("/batterylab");
  await otherPage.getByRole("combobox", { name: "Appearance" }).selectOption("dark");
  await expect(picker).toHaveValue("dark");
  await expect.poll(background).toBe("rgb(13, 17, 23)");
  await picker.selectOption("auto");
  await expect(otherPage.getByRole("combobox", { name: "Appearance" })).toHaveValue("auto");
  await otherPage.close();
  await expect.poll(background).toBe("rgb(245, 246, 248)");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(background).toBe("rgb(13, 17, 23)");
  await picker.selectOption("light");
  await page.reload();
  await expect(picker).toHaveValue("light");
  await expect.poll(background).toBe("rgb(245, 246, 248)");
  await page.screenshot({ path: info.outputPath("batterylab-light.png"), fullPage: true });
  await page.getByRole("navigation").getByRole("link", { name: "GridReplay" }).click();
  await expect(picker).toHaveValue("light");
  await picker.selectOption("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(background).toBe("rgb(13, 17, 23)");
  await page.screenshot({ path: info.outputPath("gridreplay-dark.png"), fullPage: true });
  await picker.selectOption("auto");
  await expect.poll(background).toBe("rgb(245, 246, 248)");
  await page.reload();
  await expect(picker).toHaveValue("auto");
});

test("appearance stays usable without storage and product layouts fit narrow screens", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage unavailable");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/batterylab");
  expect((await page.locator(".site").boundingBox())!.width).toBe(1160);
  const header = await page.locator(".site-header").boundingBox();
  const picker = page.getByRole("combobox", { name: "Appearance" });
  await picker.selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("navigation").getByRole("link", { name: "GridReplay" }).click();
  expect((await page.locator(".site").boundingBox())!.width).toBe(1440);
  expect(await page.locator(".site-header").boundingBox()).toEqual(header);
  await page.setViewportSize({ width: 320, height: 640 });
  for (const name of ["BatteryLab", "Prices", "GridReplay"]) {
    await page.getByRole("navigation").getByRole("link", { name }).click();
    await expect(picker).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect(errors).toEqual([]);
});

test("charts keep the selected interval when appearance changes", async ({ page }, info) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("coverage?")
        ? { region: "NSW1", days: [coverage("INCOMPLETE")] }
        : series("INCOMPLETE"),
    }),
  );
  await page.goto("/prices");
  await page.getByLabel("Market day").fill(day);
  await page.getByRole("button", { name: "Check prices" }).click();
  const plot = page.locator(".chart-plot");
  const box = (await plot.boundingBox())!;
  await page.mouse.click(box.x + 48 + (box.width - 60) * 0.6, box.y + box.height / 2);
  const cursor = page.locator('.chart-plot path[stroke="#b04a2f"][stroke-width="2"]');
  await expect(cursor).toHaveCount(1);
  const beforeX = (await cursor.boundingBox())!.x;
  await page.getByRole("combobox", { name: "Appearance" }).selectOption("dark");
  await expect(page.locator('.chart-plot path[stroke="#ffb020"]')).toHaveCount(1);
  await expect(page.locator('.chart-plot path[stroke="#ffa48b"][stroke-width="2"]')).toHaveCount(1);
  const darkCursor = page.locator('.chart-plot path[stroke="#ffa48b"][stroke-width="2"]');
  expect(Math.abs((await darkCursor.boundingBox())!.x - beforeX)).toBeLessThan(1);
  await page.screenshot({ path: info.outputPath("prices-dark-chart.png"), fullPage: true });
});
