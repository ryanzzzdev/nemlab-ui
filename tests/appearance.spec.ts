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
  for (const name of ["BatteryLab", "GridReplay"]) {
    await page.getByRole("navigation").getByRole("link", { name }).click();
    await expect(picker).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect(errors).toEqual([]);
});

test("charts keep the selected interval and window when appearance changes", async ({
  page,
}, info) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("coverage?")
        ? { region: "NSW1", days: [coverage("INCOMPLETE")] }
        : series("INCOMPLETE"),
    }),
  );
  await page.goto("/batterylab");
  await page.getByLabel("Market day").fill(day);
  await page.getByRole("button", { name: "Check prices" }).click();
  await page.getByRole("button", { name: "Show chart prototype" }).click();
  await page.getByLabel("Visible window").selectOption("1");
  const slider = page.getByRole("slider", { name: "Selected interval" });
  await slider.focus();
  await slider.press("End");
  const readout = await page.locator(".chart-readout").textContent();
  await page.getByRole("combobox", { name: "Appearance" }).selectOption("dark");
  await expect(page.locator('.linked-chart path[stroke="#69d8b6"]')).toHaveCount(1);
  await expect(page.locator('.linked-chart path[stroke="#ffa48b"]')).toHaveCount(2);
  await expect(page.locator(".chart-readout")).toHaveText(readout!);
  await expect(page.getByLabel("Visible window")).toHaveValue("1");
  await page.screenshot({ path: info.outputPath("batterylab-dark-charts.png"), fullPage: true });
});
