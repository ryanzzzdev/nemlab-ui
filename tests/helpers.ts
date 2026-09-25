import type { Page } from "@playwright/test";

// Scenario groups collapse by default; open one before filling its fields.
export function openSection(page: Page, name: string) {
  return page.locator("summary", { hasText: name }).click();
}
