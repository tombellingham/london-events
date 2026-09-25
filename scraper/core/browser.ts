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
import { USER_AGENT, detectBotWall, HttpError, isInterstitial } from "./http.ts";

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
    // Deliberately no request interception (e.g. to skip images): routing
    // changes how the browser fetches, and Cloudflare's checks notice.
    return this.context;
  }

  /** Loads `url` in `page` and waits out any JS bot check and the page's own loading. */
  private async navigate(page: Page, url: string, options: PageOptions): Promise<void> {
    this.requests++;
    const timeout = options.timeoutMs ?? 45_000;
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    await waitForChallenge(page, url, timeout);
    if (options.waitFor) {
      // "attached", not "visible": we only need the markup (and <script> JSON-LD is never visible).
      await page.waitForSelector(options.waitFor, { state: "attached", timeout: Math.min(timeout, 25_000) }).catch(() => undefined);
    } else {
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    }
    if (options.settleMs) await page.waitForTimeout(options.settleMs);
    const status = response?.status() ?? 0;
    if (status >= 400 && !(await page.title()).trim()) {
      throw new HttpError(`HTTP ${status} for ${url} (browser)`, status, url);
    }
  }

  /** Opens a page, waits out any JS bot check, runs `fn`, and always closes the page. */
  async withPage<T>(url: string, fn: (page: Page) => Promise<T>, options: PageOptions = {}): Promise<T> {
    await pageSlots.acquire();
    const context = await this.ctx();
    const page = await context.newPage();
    try {
      await this.navigate(page, url, options);
      return await fn(page);
    } finally {
      await page.close().catch(() => undefined);
      pageSlots.release();
    }
  }

  /**
   * fetch() from inside an open page (its cookies, its origin). A response
   * that is a bot check is retried a few times, since the page's own check
   * may still be completing.
   */
  private async fetchIn(page: Page, url: string, init?: RequestInit): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      this.requests++;
      const result = await page.evaluate(
        async ({ url, init }) => {
          const res = await fetch(url, { credentials: "include", ...(init ?? {}) });
          return { status: res.status, text: await res.text() };
        },
        { url, init },
      );
      if (result.status < 400 && !isInterstitial(result.text)) return result.text;
      const wall = detectBotWall(result.status >= 400 ? result.status : 403, result.text);
      if (wall && attempt < 3) {
        await page.waitForTimeout(3000 * (attempt + 1));
        continue;
      }
      throw new HttpError(`HTTP ${result.status} for ${url} (in-page fetch${wall ? `, ${wall}` : ""})`, result.status, url, Boolean(wall));
    }
  }

  /** Per origin: a page that has cleared the site's bot check, kept open for fetches. */
  private anchors = new Map<string, Promise<Page>>();

  /**
   * HTML of a page on a bot-protected site, cheaply: the first URL on an
   * origin is loaded as a real page (clearing the check) and that page is
   * kept open; later URLs on the same origin are fetched from inside it —
   * no page load, no new check. If such a fetch is refused, falls back to a
   * full page load. Returns server HTML for those later URLs, so use html()
   * for pages that only render client-side.
   */
  async sessionHtml(url: string, options: PageOptions = {}): Promise<string> {
    const origin = new URL(url).origin;
    const anchor = this.anchors.get(origin);
    if (anchor) {
      const page = await anchor.catch(() => null);
      if (page && !page.isClosed()) {
        try {
          return await this.fetchIn(page, url);
        } catch (err) {
          // Running off the end of a paginated listing: an empty page, not an error.
          if (err instanceof HttpError && err.status === 404 && !err.blocked) return "";
          if (!(err instanceof HttpError && err.blocked)) throw err;
        }
      }
      return this.html(url, options);
    }

    let resolveAnchor!: (page: Page) => void;
    let rejectAnchor!: (err: unknown) => void;
    const pending = new Promise<Page>((resolve, reject) => {
      resolveAnchor = resolve;
      rejectAnchor = reject;
    });
    pending.catch(() => undefined);
    this.anchors.set(origin, pending);

    await pageSlots.acquire();
    let page: Page | null = null;
    try {
      page = await (await this.ctx()).newPage();
      await this.navigate(page, url, options);
      const html = await page.content();
      resolveAnchor(page);
      return html;
    } catch (err) {
      this.anchors.delete(origin);
      rejectAnchor(err);
      await page?.close().catch(() => undefined);
      throw err;
    } finally {
      // The kept page idles between fetches, so it doesn't hold a page slot.
      pageSlots.release();
    }
  }

  /** Rendered HTML of a page. */
  async html(url: string, options?: PageOptions): Promise<string> {
    return this.withPage(url, (page) => page.content(), options);
  }

  /**
   * Opens a JSON URL directly and parses the body. Polls rather than parsing
   * once, because some bot checks (SiteGround's proof-of-work) bounce through
   * an interstitial page before redirecting back to the real response.
   */
  async json<T = unknown>(url: string, options: PageOptions = {}): Promise<T> {
    return this.withPage(
      url,
      async (page) => {
        const deadline = Date.now() + (options.timeoutMs ?? 45_000);
        for (;;) {
          const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
          const trimmed = text.trim();
          if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            try {
              return JSON.parse(trimmed) as T;
            } catch {
              /* still loading */
            }
          }
          if (Date.now() > deadline) {
            const wall = detectBotWall(403, await page.content().catch(() => ""));
            throw new HttpError(`Expected JSON from ${url} (browser${wall ? `, ${wall}` : ""})`, 0, url, Boolean(wall));
          }
          await page.waitForTimeout(1000);
        }
      },
      options,
    );
  }

  /**
   * Loads `pageUrl` (clearing any bot check and collecting its cookies), then
   * hands `fn` a `get(url)` that fetches from inside that page — how we read
   * JSON APIs and pages that sit behind the same protection as the HTML,
   * without paying for a full page load each time. A request that meets a
   * bot check is retried a few times while the page's own check completes.
   */
  async inPage<T>(pageUrl: string, fn: (get: (url: string, init?: RequestInit) => Promise<string>) => Promise<T>, options: PageOptions = {}): Promise<T> {
    return this.withPage(
      pageUrl,
      async (page) => fn((url, init) => this.fetchIn(page, new URL(url, pageUrl).toString(), init)),
      { settleMs: 2000, ...options },
    );
  }

  /** inPage() for a fixed list of URLs. */
  async fetchFromPage(pageUrl: string, requests: Array<string | { url: string; init?: RequestInit }>): Promise<string[]> {
    return this.inPage(pageUrl, async (get) => {
      const out: string[] = [];
      for (const req of requests) out.push(typeof req === "string" ? await get(req) : await get(req.url, req.init));
      return out;
    });
  }

  async close(): Promise<void> {
    this.anchors.clear();
    await this.context?.close().catch(() => undefined);
    this.context = null;
  }

  toString(): string {
    return `BrowserPool(${this.label})`;
  }
}

async function waitForChallenge(page: Page, url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + Math.min(timeoutMs, 35_000);
  let focused = false;
  for (;;) {
    const title = await page.title().catch(() => "");
    if (!CHALLENGE_TITLE.test(title)) return;
    if (!focused) {
      // Challenge scripts may idle in a background tab; give this one the focus.
      focused = true;
      await page.bringToFront().catch(() => undefined);
    }
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
