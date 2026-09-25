#!/usr/bin/env node
/**
 * Scraper-maintenance tool: loads pages in a real Chromium and saves, per URL,
 * the rendered HTML plus every XHR/fetch request the page made (URL, method,
 * POST body, status and the response body for JSON/HTML/text). This is how
 * the listing APIs used by the scrapers were found; when a site redesigns,
 * run it on the events page and look at probe-out/<name>.network.json.
 *
 *   node scripts/probe.mjs name=https://example.org/events [name2=url2 …]
 *   node scripts/probe.mjs --file targets.txt       # one name=url per line
 *   name=https://site/page >> https://site/api?x=1  # also fetch URLs from inside
 *                                                  # the loaded page (same cookies),
 *                                                  # saved as <name>.fetch-N.txt
 *
 * Env: PROBE_OUT (default ./probe-out), BROWSER_HEADED=1 (run under xvfb-run),
 *      CHROMIUM_PATH (custom browser binary).
 */

import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.PROBE_OUT ?? "probe-out";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const CHALLENGE = /just a moment|attention required|checking your browser|security checkpoint|verify you are human|access blocked/i;
const NOISE = /google|doubleclick|facebook|hotjar|clarity|segment|analytics|tiktok|linkedin|pinterest|twitter|cookie|consent|onetrust|cookiebot|sentry|newrelic|hubspot|bing|reddit|stripe|recaptcha|gstatic|fonts\./i;

const args = process.argv.slice(2);
let specs = args.filter((a) => a.includes("="));
const fileIdx = args.indexOf("--file");
if (fileIdx >= 0) {
  specs = readFileSync(args[fileIdx + 1], "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}
if (specs.length === 0) {
  console.error("usage: node scripts/probe.mjs name=url [...] | --file targets.txt");
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  headless: process.env.BROWSER_HEADED !== "1",
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--disable-blink-features=AutomationControlled", "--no-first-run"],
  ignoreDefaultArgs: ["--enable-automation"],
});
const context = await browser.newContext({ userAgent: UA, locale: "en-GB", timezoneId: "Europe/London", viewport: { width: 1366, height: 900 } });
await context.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));

const summary = [];
for (const spec of specs) {
  const i = spec.indexOf("=");
  const name = spec.slice(0, i);
  const [url, ...fetches] = spec.slice(i + 1).split(/\s+>>\s+/);
  const page = await context.newPage();
  const network = [];
  page.on("response", async (res) => {
    const req = res.request();
    const type = req.resourceType();
    if (!["xhr", "fetch", "document"].includes(type) || NOISE.test(res.url())) return;
    const contentType = res.headers()["content-type"] ?? "";
    let body = null;
    if (/json|html|text|xml|javascript/.test(contentType)) body = await res.text().then((t) => t.slice(0, 500_000)).catch(() => null);
    network.push({ type, method: req.method(), url: res.url(), post: req.postData()?.slice(0, 5000) ?? null, status: res.status(), contentType, body });
  });
  const started = Date.now();
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    let title = await page.title();
    for (let k = 0; k < 20 && CHALLENGE.test(title); k++) {
      await page.waitForTimeout(1500);
      title = await page.title();
    }
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    title = await page.title();
    const html = await page.content();
    writeFileSync(join(OUT, `${name}.html`), html);
    for (const [k, target] of fetches.entries()) {
      const result = await page
        .evaluate(async (u) => {
          const res = await fetch(u, { credentials: "include", headers: { Accept: "application/json, text/plain, */*" } });
          return `${res.status} ${res.headers.get("content-type")}\n\n${await res.text()}`;
        }, target)
        .catch((err) => `ERROR ${err}`);
      writeFileSync(join(OUT, `${name}.fetch-${k}.txt`), `${target}\n${result}`);
      console.log(`${name}.fetch-${k}`.padEnd(24), result.split("\n")[0]);
    }
    writeFileSync(join(OUT, `${name}.network.json`), JSON.stringify(network, null, 1));
    const xhr = network.filter((n) => n.type !== "document").length;
    summary.push({ name, url, status: response?.status(), finalUrl: page.url(), title, bytes: html.length, xhr, ms: Date.now() - started });
    console.log(`${name.padEnd(24)} ${response?.status()} ${title.slice(0, 60).padEnd(60)} ${html.length}b xhr=${xhr}`);
  } catch (err) {
    summary.push({ name, url, error: String(err).split("\n")[0] });
    console.log(`${name.padEnd(24)} ERROR ${String(err).split("\n")[0]}`);
  }
  await page.close();
}
writeFileSync(join(OUT, "_summary.json"), JSON.stringify(summary, null, 1));
await browser.close();
