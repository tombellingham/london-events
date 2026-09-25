/**
 * Fetch helpers shared by scrapers:
 *
 * - fetchHtml / fetchJson: plain HTTP first; if a bot wall answers, retry in
 *   the real browser. Once a host has walled us, the rest of this run goes
 *   straight to the browser for it (hammering a WAF with doomed plain
 *   requests only makes it stricter).
 *
 * - laterPage: pagination guard. Page 1 failing fails the source (that's a
 *   real outage), but page 4 failing shouldn't throw away pages 1–3 — keep
 *   what we have and record a warning in the health report instead.
 */

import type { ScrapeContext } from "./types.ts";
import type { PageOptions } from "./browser.ts";
import { HttpError, type RequestOptions } from "./http.ts";
import { errorMessage } from "./async.ts";

const walledHosts = new Set<string>();

/**
 * Hosts that never answer plain requests from CI: skip straight to the
 * browser. (Each doomed plain request also nudges a WAF towards suspicion.)
 */
export function preferBrowser(...hosts: string[]): void {
  for (const host of hosts) walledHosts.add(host);
}

function isBlocked(err: unknown): err is HttpError {
  return err instanceof HttpError && err.blocked;
}

export async function fetchHtml(
  ctx: ScrapeContext,
  url: string,
  options: { http?: RequestOptions; browser?: PageOptions } = {},
): Promise<string> {
  const host = new URL(url).host;
  if (!walledHosts.has(host)) {
    try {
      return await ctx.http.text(url, options.http);
    } catch (err) {
      if (!isBlocked(err)) throw err;
      walledHosts.add(host);
      ctx.log.warn(`${err.message}; using a browser for ${host}`);
    }
  }
  return ctx.browser.html(url, options.browser);
}

export async function fetchJson<T = unknown>(ctx: ScrapeContext, url: string, options: { http?: RequestOptions } = {}): Promise<T> {
  const host = new URL(url).host;
  if (!walledHosts.has(host)) {
    try {
      return await ctx.http.json<T>(url, options.http);
    } catch (err) {
      if (!isBlocked(err)) throw err;
      walledHosts.add(host);
      ctx.log.warn(`${err.message}; using a browser for ${host}`);
    }
  }
  return ctx.browser.json<T>(url);
}

/**
 * Runs one page fetch of a paginated listing. Returns null (after logging a
 * warning) when a page after the first fails, so callers can stop paginating
 * and keep the events collected so far.
 */
export async function laterPage<T>(ctx: ScrapeContext, page: number, firstPage: number, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (page <= firstPage) throw err;
    ctx.log.warn(`stopped paginating at page ${page}: ${errorMessage(err)}`);
    return null;
  }
}
