/**
 * Runs every source in isolation (one broken site never takes down the
 * build), normalizes + de-duplicates the results, and records per-source
 * health for the header indicators and the run history.
 */

import type { DateLike, EventRecord, Horizon, RawEvent, RunSummary, ScrapeContext, Source, SourceHealth, SourceSnapshot } from "./types.ts";
import { Http } from "./http.ts";
import { BrowserPool, closeBrowser } from "./browser.ts";
import { HttpError } from "./http.ts";
import { addDays, daysBetween, fromLondon, londonDate, toLondonDateTime } from "./dates.ts";
import { normalizeEvent, stillListable } from "./normalize.ts";
import { dedupe } from "./dedupe.ts";
import { errorMessage, mapLimit } from "./async.ts";

export function makeHorizon(days: number, now: Date = new Date()): Horizon {
  const fromDate = londonDate(now);
  const toDate = addDays(fromDate, days);
  return { from: fromLondon(fromDate, "00:00"), to: fromLondon(toDate, "00:00"), fromDate, toDate };
}

function dateOf(when: DateLike): string {
  if (typeof when === "string") return when.slice(0, 10);
  if (when instanceof Date) return toLondonDateTime(when).date;
  return when.date;
}

export interface RunOptions {
  horizonDays: number;
  concurrency?: number;
  /** Per-source wall-clock budget. */
  timeoutMs?: number;
  now?: Date;
  quiet?: boolean;
  /** Re-run sources that met a bot check, one at a time, after the main pass (default true). */
  retryBlocked?: boolean;
  /** Loads a source's last good scrape, to stand in for it when it fails. */
  lastGood?: (source: Source) => Promise<SourceSnapshot | null>;
  /** The oldest last good scrape (in days) that may stand in for a failed one (default 7). */
  carryMaxDays?: number;
}

export interface RunOutput {
  events: EventRecord[];
  summary: RunSummary;
  /** Each source's last good scrape, to publish for the next run: today's, or the one carried over. */
  snapshots: SourceSnapshot[];
}


interface SourceRun {
  health: SourceHealth;
  events: EventRecord[];
  /** Failed, or lost pages, because of a bot check — worth a second, solo attempt. */
  blocked: boolean;
}

const BOT_WALL = /blocked by|bot protection|bot check|captcha|challenge/i;

async function runOne(source: Source, horizon: Horizon, options: RunOptions): Promise<SourceRun> {
  const started = Date.now();
  const http = new Http(source.id);
  const browser = new BrowserPool(source.id);
  const warnings: string[] = [];
  const log = {
    info: (m: string) => {
      if (!options.quiet) console.log(`  [${source.id}] ${m}`);
    },
    warn: (m: string) => {
      if (warnings.length < 20) warnings.push(m.slice(0, 240));
      if (!options.quiet) console.warn(`  [${source.id}] ⚠ ${m}`);
    },
  };
  const ctx: ScrapeContext = {
    source,
    http,
    browser,
    horizon,
    log,
    isBeyondHorizon: (when) => dateOf(when) >= horizon.toDate,
    isBeforeHorizon: (when) => dateOf(when) < horizon.fromDate,
    inWindow: (when) => dateOf(when) >= horizon.fromDate && dateOf(when) < horizon.toDate,
  };

  let raw: RawEvent[] = [];
  let error: string | null = null;
  let blocked = false;
  const timeoutMs = source.timeoutMs ?? options.timeoutMs ?? 240_000;
  let timer: NodeJS.Timeout | undefined;
  try {
    raw = await Promise.race([
      source.scrape(ctx),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
      }),
    ]);
    if (!Array.isArray(raw)) throw new Error("scraper did not return an array");
  } catch (err) {
    error = errorMessage(err);
    blocked = (err instanceof HttpError && err.blocked) || BOT_WALL.test(error);
  } finally {
    clearTimeout(timer);
    await browser.close();
  }

  const dropped: Record<string, number> = {};
  const dropSamples: string[] = [];
  const events: EventRecord[] = [];
  for (const item of raw) {
    const result = normalizeEvent(item, source, horizon);
    if (result.ok) events.push(result.event);
    else {
      dropped[result.reason] = (dropped[result.reason] ?? 0) + 1;
      if (result.reason === "invalid" && result.detail) log.warn(`invalid event: ${result.detail}`);
      if (result.reason !== "past" && result.reason !== "beyond-horizon" && dropSamples.length < 8) {
        dropSamples.push(`${result.reason}: ${(result.detail ?? item.title ?? "").slice(0, 140)}`);
      }
    }
  }

  const status = error ? "error" : raw.length === 0 ? "empty" : "ok";
  if (!error && warnings.some((w) => /stopped paginating/i.test(w) && BOT_WALL.test(w))) blocked = true;
  return {
    blocked,
    events,
    health: {
      id: source.id,
      name: source.name,
      homepage: source.homepage,
      status,
      error,
      scraped: raw.length,
      kept: events.length,
      count: 0, // filled in after cross-source dedupe
      dropped,
      dropSamples,
      requests: http.requests + browser.requests,
      durationMs: Date.now() - started,
      warnings,
      lastOkAt: null, // filled in once the run has finished
      carried: 0,
    },
  };
}

export async function runSources(sources: Source[], options: RunOptions): Promise<RunOutput> {
  const startedAt = new Date();
  const horizon = makeHorizon(options.horizonDays, options.now);
  const report = (source: Source, r: SourceRun) => {
    if (options.quiet) return;
    const tag = r.health.status === "ok" ? "✓" : r.health.status === "empty" ? "∅" : "✗";
    console.log(`${tag} ${source.name}: ${r.health.kept} kept / ${r.health.scraped} scraped in ${(r.health.durationMs / 1000).toFixed(1)}s${r.health.error ? ` — ${r.health.error}` : ""}`);
  };
  const results = await mapLimit(sources, options.concurrency ?? 6, async (source) => {
    if (!options.quiet) console.log(`→ ${source.name}`);
    const r = await runOne(source, horizon, options);
    report(source, r);
    return r;
  });

  // Bot checks that fail while the machine is busy with a dozen other pages
  // often pass when the site is visited on its own: give those sources a
  // second, sequential attempt and keep whichever result is better.
  if (options.retryBlocked ?? true) {
    for (const [i, source] of sources.entries()) {
      if (!results[i].blocked) continue;
      if (!options.quiet) console.log(`↻ ${source.name}: retrying alone after a bot check`);
      // A freshly launched browser: checks that never clear in the long-lived
      // shared one routinely pass in a new one.
      await closeBrowser();
      const again = await runOne(source, horizon, options);
      report(source, again);
      const better = again.health.status === "ok" && (results[i].health.status !== "ok" || again.events.length > results[i].events.length);
      if (better) {
        again.health.warnings.unshift("needed a second attempt (bot check on the first)");
        again.health.durationMs += results[i].health.durationMs;
        results[i] = again;
      }
    }
  }
  await closeBrowser();

  // A source that failed today stands in with its last good scrape, if that
  // is recent enough: one bad day shouldn't empty its listings.
  const finishedAt = new Date();
  const carryMaxDays = options.carryMaxDays ?? 7;
  const snapshots: SourceSnapshot[] = [];
  for (const [i, source] of sources.entries()) {
    const r = results[i];
    if (r.health.status !== "error") {
      r.health.lastOkAt = finishedAt.toISOString();
      snapshots.push({ id: source.id, scrapedAt: r.health.lastOkAt, events: r.events });
      continue;
    }
    const previous = options.lastGood ? await options.lastGood(source).catch(() => null) : null;
    if (!previous) continue;
    snapshots.push(previous);
    r.health.lastOkAt = previous.scrapedAt;
    const age = daysBetween(londonDate(new Date(previous.scrapedAt)), horizon.fromDate);
    if (age > carryMaxDays) continue;
    r.events = previous.events.filter((e) => stillListable(e, source, horizon)).map(({ alsoAt: _, ...e }) => e);
    r.health.carried = r.events.length;
    if (!options.quiet) console.log(`↺ ${source.name}: showing ${r.events.length} events from the last good scrape (${previous.scrapedAt.slice(0, 10)})`);
  }

  const { events, exactDuplicates, crossSourceDuplicates } = dedupe(results.flatMap((r) => r.events));
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.source, (counts.get(e.source) ?? 0) + 1);
  const health = results.map((r) => ({ ...r.health, count: counts.get(r.health.id) ?? 0 }));

  return {
    events,
    snapshots,
    summary: {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      horizonDays: options.horizonDays,
      totals: {
        sources: health.length,
        ok: health.filter((h) => h.status === "ok").length,
        empty: health.filter((h) => h.status === "empty").length,
        failed: health.filter((h) => h.status === "error").length,
        events: events.length,
        duplicatesRemoved: exactDuplicates + crossSourceDuplicates,
      },
      sources: health,
    },
  };
}
