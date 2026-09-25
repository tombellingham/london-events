// Temporary reachability probe (branch-only, not shipped to master).
// Fetches each URL with plain fetch AND a real Chromium, saving bodies + a summary.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.PROBE_OUT || "probe-out";
fs.mkdirSync(OUT, { recursive: true });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const lines = fs.readFileSync(process.argv[2], "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const targets = lines.map((l) => { const i = l.indexOf("="); return { name: l.slice(0, i), url: l.slice(i + 1) }; });
const summary = [];
const titleOf = (s) => (s.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.replace(/\s+/g, " ").trim().slice(0, 80) ?? "";

for (const t of targets) {
  try {
    const res = await fetch(t.url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-GB,en;q=0.9" }, signal: AbortSignal.timeout(40000) });
    const body = await res.text();
    fs.writeFileSync(path.join(OUT, `${t.name}.fetch.html`), body);
    summary.push({ name: t.name, mode: "fetch", status: res.status, len: body.length, title: titleOf(body), url: res.url });
  } catch (e) { summary.push({ name: t.name, mode: "fetch", error: String(e.cause?.code || e.message) }); }
}

for (const headless of [true, false]) {
  let browser;
  try { browser = await chromium.launch({ headless }); } catch (e) { summary.push({ mode: `browser-launch-${headless}`, error: e.message.split("\n")[0] }); continue; }
  const ctx = await browser.newContext({ userAgent: UA, locale: "en-GB", timezoneId: "Europe/London", viewport: { width: 1366, height: 900 } });
  for (const t of targets) {
    const page = await ctx.newPage();
    try {
      const resp = await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      let title = await page.title();
      for (let k = 0; k < 10 && /moment|attention|checkpoint|access blocked/i.test(title); k++) { await page.waitForTimeout(2000); title = await page.title(); }
      try { await page.waitForLoadState("networkidle", { timeout: 8000 }); } catch {}
      const html = await page.content();
      fs.writeFileSync(path.join(OUT, `${t.name}.${headless ? "headless" : "headed"}.html`), html);
      summary.push({ name: t.name, mode: headless ? "headless" : "headed", status: resp?.status(), len: html.length, title: await page.title(), url: page.url() });
    } catch (e) { summary.push({ name: t.name, mode: headless ? "headless" : "headed", error: e.message.split("\n")[0] }); }
    await page.close();
  }
  await browser.close();
}
fs.writeFileSync(path.join(OUT, "_summary.json"), JSON.stringify(summary, null, 1));
for (const s of summary) console.log(JSON.stringify(s));
