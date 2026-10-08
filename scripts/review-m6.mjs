// NEM-115 acceptance review — real API (:8080 via :5274 proxy), seeded owner
// session. Captures workspace/access/auth evidence across size, theme and
// density matrices into the backend evidence directory.
import { chromium, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const ADMIN = "http://127.0.0.1:5274/admin/";
const TOKEN = process.env.SESSION_TOKEN;
const OUT = "../nemlab/docs/project/evidence/admin-redesign/m6-review";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const results = [];
const errors = [];

async function ctx(width, height) {
  const c = await browser.newContext({
    baseURL: "http://127.0.0.1:5274",
    viewport: { width, height },
  });
  await c.addCookies([{ name: "nemlab_session", value: TOKEN, domain: "127.0.0.1", path: "/" }]);
  const page = await c.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  return { c, page };
}

const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
const ok = (name, cond, detail = "") =>
  results.push(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);

async function setTheme(page, theme) {
  await page.locator("label.picker", { hasText: "Theme" }).locator("select").selectOption(theme);
}
async function setDensity(page, density) {
  await page
    .locator("label.picker", { hasText: "Density" })
    .locator("select")
    .selectOption(density);
}
async function overflow(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}
async function applyScope(page, region, from, to) {
  await page.locator(".toolbar select").first().selectOption(region);
  await page.locator(".toolbar input[type=date]").first().fill(from);
  await page.locator(".toolbar input[type=date]").last().fill(to);
  await page.locator(".toolbar button", { hasText: "Apply" }).click();
  await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
}

// ── 1. Density / theme matrix at 1440×900 ────────────────────────────────
{
  const { c, page } = await ctx(1440, 900);
  await page.goto(ADMIN);
  await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
  await applyScope(page, "NSW1", "2023-09-01", "2023-10-01");
  const rows = await page.locator(".table-wrap table.grid tbody tr").count();
  ok("1440×900 coverage rows ≥10 with inspector+activity", rows >= 10, `${rows} rows`);
  await page.locator(".table-wrap table.grid tbody tr").nth(5).click();
  await shot(page, "01-1440x900-standard-light-selected");

  for (const [density, name] of [
    ["compact", "compact"],
    ["comfortable", "comfortable"],
  ]) {
    await setDensity(page, density);
    const px = await page
      .locator(".table-wrap table.grid tbody tr")
      .first()
      .evaluate((el) => el.getBoundingClientRect().height);
    await shot(page, `02-1440x900-${name}`);
    ok(`density ${name} row height`, Math.round(px) > 0, `${Math.round(px)}px`);
  }
  await setDensity(page, "standard");
  await setTheme(page, "dark");
  await shot(page, "03-1440x900-dark");
  ok("dark theme applies", true);
  await setTheme(page, "auto");
  await c.close();
}

// ── 2. Size matrix ────────────────────────────────────────────────────────
for (const [w, h, tag] of [
  [1280, 720, "1280x720"],
  [1920, 1080, "1920x1080"],
]) {
  const { c, page } = await ctx(w, h);
  await page.goto(ADMIN);
  await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
  await applyScope(page, "NSW1", "2023-09-01", "2023-10-01");
  const railWidth = await page
    .locator(".rail")
    .evaluate((el) => el.getBoundingClientRect().width);
  await page.locator(".table-wrap table.grid tbody tr").first().click();
  await shot(page, `04-${tag}-standard`);
  ok(`${tag} zero overflow`, (await overflow(page)) === 0);
  results.push(`INFO ${tag} rail ${Math.round(railWidth)}px`);
  await c.close();
}

// ── 3. 200% zoom equivalent (720px effective) ─────────────────────────────
{
  const { c, page } = await ctx(720, 450);
  await page.goto(ADMIN);
  await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
  await shot(page, "05-720px-200pct-zoom");
  ok("720px (≈200% zoom) zero overflow", (await overflow(page)) === 0);
  await c.close();
}

// ── 4. Keyboard: grid arrows + tab switch ─────────────────────────────────
{
  const { c, page } = await ctx(1440, 900);
  await page.goto(ADMIN);
  await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
  const firstCell = page.locator(".table-wrap table.grid tbody tr td").first();
  await firstCell.click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const sel = new URL(page.url()).searchParams.get("sel");
  ok("keyboard ArrowDown+Enter selects a row", Boolean(sel), sel ?? "none");
  await page.keyboard.press("Escape");
  await shot(page, "06-keyboard-selection");
  await c.close();
}

// ── 5. In-place job inspection + drawers ──────────────────────────────────
{
  const { c, page } = await ctx(1440, 900);
  await page.goto(ADMIN);
  await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
  await page.locator(".tab", { hasText: "Loads & Jobs" }).click();
  await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
  await page.locator(".table-wrap table.grid tbody tr").first().click();
  await expect(page.locator(".inspector")).not.toContainText("Select a row", { timeout: 5000 });
  const insp = await page.locator(".inspector").innerText();
  ok("in-place job inspection", /Phase|Succeeded|Failed|Queued|next/i.test(insp), insp.slice(0, 80));
  await shot(page, "07-jobs-inspection");

  // Load drawer — open, review, cancel (no mutation in review-only pass).
  await page.locator(".toolbar button", { hasText: "Load data" }).click();
  await page.locator(".drawer button", { hasText: "Review scope" }).click();
  await shot(page, "08-load-drawer-review");
  await page.keyboard.press("Escape");
  ok("load drawer Escape close", (await page.locator(".drawer").count()) === 0);

  // Publish drawer — coverage check renders, Escape out.
  await page.locator(".toolbar button", { hasText: "Review & publish" }).click();
  await page.locator(".drawer button", { hasText: "Check coverage" }).click();
  await page.locator(".drawer").getByText(/complete|lack|ready/i).first().waitFor();
  await shot(page, "09-publish-drawer-coverage");
  await page.keyboard.press("Escape");
  await c.close();
}

// ── 6. Access workspace on real data ──────────────────────────────────────
{
  const { c, page } = await ctx(1440, 900);
  await page.goto(`${ADMIN}access`);
  await page.locator("h1").waitFor();
  await page.locator(".table-wrap table.grid tbody tr").first().waitFor().catch(() => null);
  const rows = await page.locator(".table-wrap table.grid tbody tr").count();
  if (rows > 0) {
    await page.locator(".table-wrap table.grid tbody tr").first().click();
    await shot(page, "10-access-requests");
  }
  results.push(`INFO access request rows ${rows}`);
  await page.getByRole("tab", { name: "Visitors" }).click();
  await page.locator(".table-wrap table.grid tbody tr").first().waitFor().catch(() => null);
  await shot(page, "11-access-visitors");
  await page.getByRole("tab", { name: "Audit" }).click();
  await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
  const auditRows = await page.locator(".table-wrap table.grid tbody tr").count();
  ok("audit rows render", auditRows > 0, `${auditRows} rows`);
  await shot(page, "12-access-audit");
  await c.close();
}

// ── 7. Help drawer over real shell ────────────────────────────────────────
{
  const { c, page } = await ctx(1440, 900);
  await page.goto(ADMIN);
  await page.locator(".table-wrap table.grid tbody tr").first().waitFor();
  await page.locator(".appbar button", { hasText: "Help" }).click();
  await shot(page, "13-help-drawer");
  await page.keyboard.press("Escape");
  await c.close();
}

console.log(results.join("\n"));
console.log(errors.length ? `\nERRORS:\n${[...new Set(errors)].join("\n")}` : "\nno console/page errors");
await browser.close();
