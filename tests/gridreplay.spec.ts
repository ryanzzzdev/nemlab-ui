import { expect, test } from "@playwright/test";
import { eventPage, events, highlightsPage, routeGridReplay } from "./fixtures/gridreplay";

test.beforeEach(async ({ page, context }) => {
  await context.addCookies([
    { name: "operator", value: "must-not-send", url: "http://127.0.0.1:4173" },
  ]);
  await page.route("**/api/v1/events**", (route) => routeGridReplay(route));
});

test("highlights are the default view and a replay opens from a card", async ({ page }) => {
  await page.goto("/gridreplay");
  await expect(page.getByText(/NSW1 · 2023-09-01 to 2023-10-01 · 2 events/)).toBeVisible();
  await expect(
    page.getByText("2 highlights selected from 2 eligible of 2 matching events"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Negative prices for 15 minutes/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Price spike to 1500.25/ })).toBeVisible();
  // Each card shows its truthful rank and a bounded preview sparkline.
  await expect(page.getByText("#1 longest negative run of 12 eligible")).toBeVisible();
  await expect(page.locator(".event-card svg.spark").first()).toBeVisible();

  await page.getByRole("button", { name: /Negative prices for 15 minutes/ }).click();
  await expect(page).toHaveURL(/event=aaaaaaaa-1111-4000-8000-000000000001/);
  await expect(page.getByRole("heading", { name: "Replay", exact: true })).toBeVisible();
  await expect(page.locator(".chart-plot svg").first()).toBeVisible();
  await expect(page.locator(".chart-card")).toHaveCount(4);
  await expect(page.getByText("Regional price")).toBeVisible();
  await expect(page.getByText("Generation by technology")).toBeVisible();
  await expect(page.locator(".replay-clock")).toContainText("2023-09-04");
  await expect(page.locator(".replay-readout")).toContainText("AUD/MWh");
  await expect(page.getByRole("link", { name: "Open in BatteryLab" })).toHaveAttribute(
    "href",
    "/batterylab?day=2023-09-04",
  );
});

test("All events lists the catalogue with typed sorts and bounds", async ({ page }) => {
  const seen: URL[] = [];
  await page.route("**/api/v1/events**", (route) =>
    routeGridReplay(route, { onList: (url) => seen.push(url) }),
  );
  await page.goto("/gridreplay");
  await page.getByRole("button", { name: "All events" }).click();
  await expect(page).toHaveURL(/view=all/);
  await expect(page.getByText("2 matching events")).toBeVisible();

  await page
    .locator(".replay-filters")
    .getByRole("combobox", { name: "Event type" })
    .selectOption("price_spike");
  await page
    .locator(".replay-filters")
    .getByRole("combobox", { name: "Sort" })
    .selectOption("highest");
  await page.getByRole("button", { name: "Update list" }).click();
  await expect(page).toHaveURL(/type=price_spike/);
  await expect(page).toHaveURL(/sort=highest/);
  // Requests so far: highlights on load, catalogue on view switch, filtered
  // catalogue after Update list.
  await expect.poll(() => seen.length).toBe(3);
  const last = seen[2]!;
  expect(last.pathname).toBe("/api/v1/events");
  expect(last.searchParams.get("type")).toBe("price_spike");
  expect(last.searchParams.get("sort")).toBe("highest");

  // Numeric bounds appear only for the types that support them.
  await page.locator(".replay-more summary").click();
  await page
    .locator(".replay-more")
    .getByRole("spinbutton", { name: "Min duration (min)" })
    .fill("10");
  await page.locator(".replay-more").getByRole("textbox", { name: "Value at least" }).fill("500");
  await page.getByRole("button", { name: "Update list" }).click();
  await expect.poll(() => seen.length).toBe(4);
  expect(seen[3]!.searchParams.get("minDurationMinutes")).toBe("10");
  expect(seen[3]!.searchParams.get("valueGte")).toBe("500");
});

test("filters are sent to the highlights scope", async ({ page }) => {
  const seen: URL[] = [];
  await page.route("**/api/v1/events**", (route) =>
    routeGridReplay(route, { highlights: highlightsPage([]), onList: (url) => seen.push(url) }),
  );
  await page.goto("/gridreplay");
  await expect(page.getByText("No highlights in this scope")).toBeVisible();
  await page
    .locator(".replay-filters")
    .getByRole("combobox", { name: "Event type" })
    .selectOption("price_spike");
  await page
    .locator(".replay-filters")
    .getByRole("textbox", { name: "From", exact: true })
    .fill("2023-09-03");
  await page
    .locator(".replay-filters")
    .getByRole("textbox", { name: "To", exact: true })
    .fill("2023-09-05");
  await page.getByRole("button", { name: "Update list" }).click();
  await expect.poll(() => seen.length).toBe(2);
  const filtered = seen[1]!;
  expect(filtered.pathname).toBe("/api/v1/events/highlights");
  expect(filtered.searchParams.get("type")).toBe("price_spike");
  expect(filtered.searchParams.get("from")).toBe("2023-09-03");
  expect(filtered.searchParams.get("to")).toBe("2023-09-05");
  expect(filtered.searchParams.get("region")).toBe("NSW1");
});

test("a shared replay link opens the same event", async ({ page }) => {
  await page.goto(`/gridreplay?event=${events[1]!.id}`);
  await expect(page.getByRole("heading", { name: "Replay", exact: true })).toBeVisible();
  await expect(page.locator(".chart-plot svg").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Price spike to 1500.25/ })).toBeVisible();
});

test("the replay slider and play controls move the shared cursor", async ({ page }) => {
  await page.goto(`/gridreplay?event=${events[0]!.id}`);
  await expect(page.locator(".chart-plot svg").first()).toBeVisible();
  const slider = page.getByRole("slider", { name: "Replay position" });
  await slider.fill("150");
  await expect(page.locator(".replay-clock")).toContainText("12:35");
  // -8.5 AUD/MWh at intervals 100–102; the slider lands on the flat price 42.10.
  await expect(page.locator(".replay-readout")).toContainText("42.10");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
});

test("filter and event state round-trip through the URL", async ({ page }) => {
  const seen: URL[] = [];
  await page.route("**/api/v1/events**", (route) =>
    routeGridReplay(route, { onList: (url) => seen.push(url) }),
  );
  // A shared filtered link applies its filters on direct load.
  await page.goto("/gridreplay?type=price_spike&from=2023-09-03&to=2023-09-05");
  await expect(page.getByRole("button", { name: /Price spike to 1500.25/ })).toBeVisible();
  const loaded = seen[0]!;
  expect(loaded.pathname).toBe("/api/v1/events/highlights");
  expect(loaded.searchParams.get("type")).toBe("price_spike");
  expect(loaded.searchParams.get("from")).toBe("2023-09-03");
  // Opening a card keeps the filter params and adds the event.
  await page.getByRole("button", { name: /Price spike to 1500.25/ }).click();
  await expect(page).toHaveURL(/type=price_spike/);
  await expect(page).toHaveURL(/event=aaaaaaaa-1111-4000-8000-000000000002/);
  // Back restores the catalogue-only view.
  await page.goBack();
  await expect(page).not.toHaveURL(/event=/);
});

test("invalid URL parameters fall back to defaults", async ({ page }) => {
  const seen: URL[] = [];
  await page.route("**/api/v1/events**", (route) =>
    routeGridReplay(route, { onList: (url) => seen.push(url) }),
  );
  await page.goto(
    "/gridreplay?view=bogus&region=XX9&type=bogus&sort=highest&from=nope&to=also-nope&event=not-a-uuid",
  );
  await expect(page.getByRole("button", { name: /Negative prices for 15 minutes/ })).toBeVisible();
  const loaded = seen[0]!;
  expect(loaded.pathname).toBe("/api/v1/events/highlights");
  expect(loaded.searchParams.get("region")).toBe("NSW1");
  expect(loaded.searchParams.get("type")).toBeNull();
  expect(loaded.searchParams.get("from")).toBeNull();
  expect(loaded.searchParams.get("sort")).toBeNull();
  await expect(page.getByRole("heading", { name: "Replay", exact: true })).toHaveCount(0);
});

test("an unpublished region shows an honest empty state", async ({ page }) => {
  await page.route("**/api/v1/events**", async (route) => {
    await route.fulfill({
      status: 404,
      json: { code: "CATALOGUE_NOT_PUBLISHED", message: "no catalogue" },
    });
  });
  await page.goto("/gridreplay");
  await expect(page.getByText("No catalogue published for NSW1")).toBeVisible();
});

test("a removed event explains it is no longer available", async ({ page }) => {
  await page.route("**/api/v1/events/**/replay", async (route) => {
    await route.fulfill({
      status: 404,
      json: { code: "EVENT_NOT_FOUND", message: "gone" },
    });
  });
  await page.goto(`/gridreplay?event=${events[0]!.id}`);
  await expect(page.getByText("This event is no longer in the published catalogue.")).toBeVisible();
});

test("catalogue pagination fetches the pinned next page", async ({ page }) => {
  const cursors: (string | null)[] = [];
  await page.route("**/api/v1/events**", (route) =>
    routeGridReplay(route, {
      page: (cursor) => {
        cursors.push(cursor);
        return cursor
          ? eventPage([{ ...events[1]!, id: "aaaaaaaa-1111-4000-8000-000000000099" }])
          : { ...eventPage([events[0]!]), nextCursor: "pinned-cursor" };
      },
    }),
  );
  await page.goto("/gridreplay?view=all");
  await expect(page.getByText(/Negative prices for 15 minutes/)).toBeVisible();
  await page.getByRole("button", { name: "Show more events" }).click();
  await expect(page.getByText(/Price spike to 1500.25/)).toBeVisible();
  expect(cursors).toEqual([null, "pinned-cursor"]);
});

test("Open in BatteryLab prefills the event's market day", async ({ page }) => {
  await page.goto(`/gridreplay?event=${events[0]!.id}`);
  await expect(page.locator(".chart-plot svg").first()).toBeVisible();
  await page.getByRole("link", { name: "Open in BatteryLab" }).click();
  await expect(page).toHaveURL("/batterylab?day=2023-09-04");
  await expect(page.getByLabel("Simulation day (UTC+10)")).toHaveValue("2023-09-04");
});

test("gridreplay stays usable at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(`/gridreplay?event=${events[0]!.id}`);
  await expect(page.locator(".chart-plot svg").first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
