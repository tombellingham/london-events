/**
 * Shared headless/headed Chromium for sources that can't be read with plain
 * HTTP: pages rendered client-side, or sites behind a JavaScript bot check
 * that a normal browser passes automatically.
 *
 * We never try to solve interactive CAPTCHAs — if a check still hasn't
 * cleared after waiting, the source fails with a clear "blocked" error and
 * shows up red in the health report.
 *
 * Environment:
 *   CHROMIUM_PATH=/path/to/chrome   use a specific Chromium build
 *   BROWSER_HEADED=1                run headed (CI wraps the scrape in xvfb-run;
 *                                   several Cloudflare setups only pass headed)
 */

import type { Browser, BrowserContext, Page } from "playwright";
import { USER_AGENT, detectBotWall, HttpError } from "./http.ts";

const CHALLENGE_TITLE = /just a moment|attention required|checking your browser|security checkpoint|verify you are human|access blocked|please wait/i;

export interface PageOptions {
  /** Wait for this selector after load (content rendered client-side). */
  waitFor?: string;
  timeoutMs?: number;
  /** Extra settle time after load, for pages that stream content in. */
  settleMs?: number;
}

class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }
  release(): void {
    this.active--;
    this.queue.shift()?.();
  }
}

let browserPromise: Promise<Browser> | null = null;
const pageSlots = new Semaphore(Number(process.env.BROWSER_PAGES ?? 4));

async function launch(): Promise<Browser> {
  const { chromium } = await import("playwright");
  const headed = process.env.BROWSER_HEADED === "1";
  return chromium.launch({
    headless: !headed,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
}

async function getBrowser(): Promise<Browser> {
  browserPromise ??= launch();
  return browserPromise;
}

/** One pool per source: its own cookie jar, so a cleared bot check is reused across that source's pages. */
export class BrowserPool {
  /** Page loads + in-page fetches (for health stats). */
  requests = 0;
  private context: BrowserContext | null = null;

  constructor(private readonly label: string) {}

  private async ctx(): Promise<BrowserContext> {
    if (this.context) return this.context;
    const browser = await getBrowser();
    this.context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: "en-GB",
      timezoneId: "Europe/London",
      viewport: { width: 1366, height: 900 },
    });
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    // Images, fonts and media are never needed for extraction.
    await this.context.route("**/*", (route) => {
      const type = route.request().resourceType();
      return type === "image" || type === "media" || type === "font" ? route.abort() : route.continue();
    });
    return this.context;
  }

  /** Opens a page, waits out any JS bot check, runs `fn`, and always closes the page. */
  async withPage<T>(url: string, fn: (page: Page) => Promise<T>, options: PageOptions = {}): Promise<T> {
    await pageSlots.acquire();
    const context = await this.ctx();
    const page = await context.newPage();
    try {
      this.requests++;
      const timeout = options.timeoutMs ?? 45_000;
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout });
      await waitForChallenge(page, url, timeout);
      if (options.waitFor) {
        await page.waitForSelector(options.waitFor, { timeout: Math.min(timeout, 25_000) }).catch(() => undefined);
      } else {
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      }
      if (options.settleMs) await page.waitForTimeout(options.settleMs);
      const status = response?.status() ?? 0;
      if (status >= 400 && !(await page.title()).trim()) {
        throw new HttpError(`HTTP ${status} for ${url} (browser)`, status, url);
      }
      return await fn(page);
    } finally {
      await page.close().catch(() => undefined);
      pageSlots.release();
    }
  }

  /** Rendered HTML of a page. */
  async html(url: string, options?: PageOptions): Promise<string> {
    return this.withPage(url, (page) => page.content(), options);
  }

  /**
   * Loads `pageUrl` (clearing any bot check and collecting cookies), then
   * performs same-origin fetches from inside the page — how we read JSON APIs
   * that sit behind the same protection as the HTML.
   */
  async fetchFromPage(pageUrl: string, requests: Array<string | { url: string; init?: RequestInit }>): Promise<string[]> {
    return this.withPage(pageUrl, async (page) => {
      const out: string[] = [];
      for (const req of requests) {
        const spec = typeof req === "string" ? { url: req, init: undefined } : req;
        this.requests++;
        const result = await page.evaluate(async ({ url, init }) => {
          const res = await fetch(url, { credentials: "include", ...(init ?? {}) });
          return { status: res.status, text: await res.text() };
        }, spec);
        if (result.status >= 400) {
          const wall = detectBotWall(result.status, result.text);
          throw new HttpError(`HTTP ${result.status} for ${spec.url} (in-page fetch${wall ? `, ${wall}` : ""})`, result.status, spec.url, Boolean(wall));
        }
        out.push(result.text);
      }
      return out;
    });
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    this.context = null;
  }

  toString(): string {
    return `BrowserPool(${this.label})`;
  }
}

async function waitForChallenge(page: Page, url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + Math.min(timeoutMs, 35_000);
  for (;;) {
    const title = await page.title().catch(() => "");
    if (!CHALLENGE_TITLE.test(title)) return;
    if (Date.now() > deadline) {
      const html = await page.content().catch(() => "");
      const wall = detectBotWall(403, html) ?? "bot protection";
      throw new HttpError(`Blocked by ${wall} at ${url} (challenge did not clear in a real browser)`, 403, url, true);
    }
    await page.waitForTimeout(1000);
  }
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close().catch(() => undefined);
}
