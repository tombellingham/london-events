/**
 * Polite HTTP client used by every scraper.
 *
 *  - Browser-like headers (several sites 403 anything that looks like a bot).
 *  - Per-host concurrency + spacing, shared across all sources, so pagination
 *    and detail-page fan-out never hammer a single site.
 *  - Retries with backoff for network errors, 429 and 5xx; never for 4xx.
 *  - Recognises bot walls (Cloudflare, SiteGround, Vercel…) and says so in
 *    the error, because "403" alone sends you debugging the wrong thing.
 *  - Optional on-disk cache for development (HTTP_CACHE=1), so re-running a
 *    scraper while iterating on its parser doesn't re-hit the site.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
};

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly blocked: boolean = false,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** URL-encoded form body (sets content-type). */
  form?: Record<string, string | number>;
  /** JSON body (sets content-type). */
  json?: unknown;
  body?: string;
  timeoutMs?: number;
  retries?: number;
  /** Treat these non-2xx statuses as success (the caller inspects `status`). */
  allowStatus?: number[];
  /** Skip the dev cache for this request. */
  noCache?: boolean;
}

export interface HttpResponse {
  status: number;
  url: string;
  text: string;
  headers: Headers | Record<string, string>;
}

interface HostLimits {
  concurrency: number;
  intervalMs: number;
}

const DEFAULT_LIMITS: HostLimits = { concurrency: 2, intervalMs: 400 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class HostGate {
  private active = 0;
  private lastStart = 0;
  constructor(public limits: HostLimits) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      const spacing = now - this.lastStart;
      if (this.active < this.limits.concurrency && spacing >= this.limits.intervalMs) {
        this.active++;
        this.lastStart = now;
        return;
      }
      const wait = this.active >= this.limits.concurrency ? 40 : this.limits.intervalMs - spacing;
      await sleep(Math.max(10, wait) + Math.random() * 20);
    }
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
  }
}

const gates = new Map<string, HostGate>();
const hostLimits = new Map<string, HostLimits>();

function gateFor(host: string): HostGate {
  let gate = gates.get(host);
  if (!gate) {
    gate = new HostGate(hostLimits.get(host) ?? DEFAULT_LIMITS);
    gates.set(host, gate);
  }
  return gate;
}

/** Tighten limits for a sensitive host (applies to every source hitting it). */
export function configureHost(host: string, limits: Partial<HostLimits>): void {
  const merged = { ...(hostLimits.get(host) ?? DEFAULT_LIMITS), ...limits };
  hostLimits.set(host, merged);
  const gate = gates.get(host);
  if (gate) gate.limits = merged;
}

/** Returns a human label when a response is a bot-protection interstitial rather than content. */
export function detectBotWall(status: number, body: string): string | null {
  const head = body.slice(0, 6000);
  if (/Just a moment\.\.\.|cf-chl|challenge-platform|Attention Required! \| Cloudflare/i.test(head)) return "Cloudflare bot protection";
  if (/sgcaptcha/i.test(head)) return "SiteGround captcha";
  if (/Vercel Security Checkpoint/i.test(head)) return "Vercel security checkpoint";
  if (/_Incapsula_Resource|Incapsula incident/i.test(head)) return "Imperva/Incapsula";
  if (status === 403 && /Access (?:Blocked|Denied)|Request blocked/i.test(head)) return "access blocked (WAF)";
  return null;
}

// ---------------------------------------------------------------------------
// Dev cache
// ---------------------------------------------------------------------------

const CACHE_ENABLED = process.env.HTTP_CACHE === "1";
const CACHE_DIR = process.env.HTTP_CACHE_DIR ?? join(process.cwd(), ".cache", "http");
const CACHE_TTL_MS = Number(process.env.HTTP_CACHE_TTL_MIN ?? 120) * 60_000;

function cacheKey(method: string, url: string, body: string | undefined): string {
  return createHash("sha1").update(`${method} ${url}\n${body ?? ""}`).digest("hex");
}

function readCache(key: string): HttpResponse | null {
  if (!CACHE_ENABLED) return null;
  const file = join(CACHE_DIR, `${key}.json`);
  if (!existsSync(file) || Date.now() - statSync(file).mtimeMs > CACHE_TTL_MS) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as HttpResponse;
  } catch {
    return null;
  }
}

function writeCache(key: string, res: HttpResponse): void {
  if (!CACHE_ENABLED) return;
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify({ ...res, headers: {} }));
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class Http {
  /** Requests actually sent (cache hits excluded). */
  requests = 0;

  constructor(private readonly label: string) {}

  async request(url: string, options: RequestOptions = {}): Promise<HttpResponse> {
    const method = options.method ?? (options.form || options.json || options.body ? "POST" : "GET");
    const headers: Record<string, string> = { ...DEFAULT_HEADERS, ...options.headers };
    let body = options.body;
    if (options.form) {
      body = new URLSearchParams(Object.entries(options.form).map(([k, v]) => [k, String(v)])).toString();
      headers["Content-Type"] ??= "application/x-www-form-urlencoded; charset=UTF-8";
    } else if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      headers["Content-Type"] ??= "application/json";
    }

    const key = cacheKey(method, url, body);
    if (!options.noCache) {
      const cached = readCache(key);
      if (cached) return cached;
    }

    const retries = options.retries ?? 2;
    const host = new URL(url).host;
    const gate = gateFor(host);
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(attempt === 1 ? 1500 : 5000);
      await gate.acquire();
      let res: Response;
      let text: string;
      try {
        this.requests++;
        res = await fetch(url, {
          method,
          headers,
          body,
          redirect: "follow",
          signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
        });
        text = await res.text();
      } catch (err) {
        lastError = err;
        continue; // network error / timeout → retry
      } finally {
        gate.release();
      }

      const ok = (res.status >= 200 && res.status < 300) || options.allowStatus?.includes(res.status);
      if (ok) {
        const out: HttpResponse = { status: res.status, url: res.url || url, text, headers: res.headers };
        if (res.status >= 200 && res.status < 300) writeCache(key, out);
        return out;
      }

      const wall = detectBotWall(res.status, text);
      const message = `HTTP ${res.status} for ${url}${wall ? ` (${wall})` : ""}`;
      lastError = new HttpError(message, res.status, url, Boolean(wall));
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || wall) break;
      const retryAfter = Number(res.headers.get("retry-after"));
      if (retryAfter > 0) await sleep(Math.min(retryAfter, 10) * 1000);
    }

    if (lastError instanceof HttpError) throw lastError;
    const cause = lastError as { message?: string; cause?: { code?: string; message?: string } } | undefined;
    const detail = cause?.cause?.code ?? cause?.cause?.message ?? cause?.message ?? String(lastError);
    throw new HttpError(`Request failed for ${url}: ${detail}`, 0, url);
  }

  async text(url: string, options?: RequestOptions): Promise<string> {
    return (await this.request(url, options)).text;
  }

  async json<T = unknown>(url: string, options?: RequestOptions): Promise<T> {
    const res = await this.request(url, {
      ...options,
      headers: { Accept: "application/json, text/plain, */*", ...options?.headers },
    });
    try {
      return JSON.parse(res.text) as T;
    } catch {
      const wall = detectBotWall(res.status, res.text);
      throw new HttpError(`Expected JSON from ${url}${wall ? ` but got ${wall}` : ""}`, res.status, url, Boolean(wall));
    }
  }

  toString(): string {
    return `Http(${this.label})`;
  }
}
