import { chromium } from "playwright";
import { readFileSync } from "fs";
const browser = await chromium.launch();
const fixture = JSON.parse(readFileSync("/tmp/eventpage.json", "utf8"));
const replayFixture = JSON.parse(readFileSync("/tmp/replay.json", "utf8"));
for (const [w, h] of [
  [1440, 900],
  [768, 900],
  [390, 844],
  [320, 700],
]) {
  for (const theme of ["light", "dark"]) {
    // Catalogue view (no event selected)
    const app = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: theme });
    await app.route("**/api/v1/events**", (route) => {
      const url = new URL(route.request().url());
      const m = url.pathname.match(/\/([0-9a-f-]{36})\/replay$/);
      route.fulfill({ json: m ? replayFixture : fixture });
    });
    await app.goto("http://127.0.0.1:4173/gridreplay");
    await app.locator(".event-card").first().waitFor();
    await app.screenshot({ path: `/tmp/fidelity/app-cat-${w}-${theme}.png` });
    // Replay view
    await app.goto("http://127.0.0.1:4173/gridreplay?event=aaaaaaaa-1111-4000-8000-000000000001");
    await app.locator(".chart-plot svg").first().waitFor();
    await app.waitForTimeout(300);
    await app.screenshot({ path: `/tmp/fidelity/app-${w}-${theme}.png` });
    await app.close();
    console.log(`done ${w} ${theme}`);
  }
}
await browser.close();
