/**
 * Shared types for the scraping pipeline.
 *
 * Scrapers produce loosely-structured `RawEvent`s; `normalize.ts` turns those
 * into strict `EventRecord`s (the shape that ships to the browser).
 */

import type { Http } from "./http.ts";
import type { BrowserPool } from "./browser.ts";

/** A wall-clock moment in Europe/London, e.g. { date: "2026-09-28", time: "19:30" }. */
export interface LondonDateTime {
  /** YYYY-MM-DD, London calendar date. */
  date: string;
  /** HH:MM (24h), London wall-clock time, or null when the source gives no time. */
  time: string | null;
}

/** What a scraper hands back. Only title, url and start are mandatory. */
export interface RawEvent {
  title: string;
  url: string;
  /**
   * Either a London wall-clock date/time, or an absolute instant (a `Date`,
   * e.g. parsed from an ISO string with a correct offset). Prefer whichever
   * the source actually provides — don't round-trip through the other.
   */
  start: LondonDateTime | Date;
  /** Optional end, used only to discard long-running exhibitions/courses. */
  end?: LondonDateTime | Date | null;
  location?: string | null;
  description?: string | null;
  speakers?: string[];
  /** true = free, false = paid, null/undefined = let the classifier decide. */
  free?: boolean | null;
  /** true = online only, false = in-person or hybrid, null/undefined = classifier decides. */
  online?: boolean | null;
  /** Raw price text as shown by the source ("£15 / £10 concessions", "Free"). */
  priceText?: string | null;
  /** Free-form hints for the classifiers (event type, format labels…). */
  hints?: string[];
  tags?: string[];
}

/** The normalized record shipped to the client. Keep keys short-ish: this is serialized ~1-2k times. */
export interface EventRecord {
  id: string;
  source: string;
  title: string;
  url: string;
  /** YYYY-MM-DD in London. */
  date: string;
  /** HH:MM in London, or null if unknown. */
  time: string | null;
  /** ISO instant (UTC) used for sorting/filtering; for time-less events it's London midnight. */
  start: string;
  location: string | null;
  description: string | null;
  speakers: string[];
  free: boolean | null;
  online: boolean | null;
  price: string | null;
  /** Other sources that listed the same event (fuzzy cross-source dedupe). */
  alsoAt?: { source: string; url: string }[];
}

export interface SourceDefaults {
  /** Used when neither the scraper nor the classifier can tell. */
  free?: boolean;
  online?: boolean;
  /** Fallback venue, e.g. "Conway Hall, Red Lion Square". */
  location?: string;
}

export interface Source {
  /** Stable machine id — used in URLs/filters, never change once shipped. */
  id: string;
  /** Display name. */
  name: string;
  /** Human-facing events page (linked from the sources list). */
  homepage: string;
  defaults?: SourceDefaults;
  /** Optional per-source keep/skip filter applied after normalization (e.g. drop internal staff events). */
  include?: (event: EventRecord) => boolean;
  /** Wall-clock budget for this source (default 4 minutes); browser-heavy sources need more. */
  timeoutMs?: number;
  scrape: (ctx: ScrapeContext) => Promise<RawEvent[]>;
}

/** Anything we can read a London date from. */
export type DateLike = { date: string } | Date | string;

export interface Horizon {
  /** Start of today in London (inclusive). */
  from: Date;
  /** Exclusive upper bound. */
  to: Date;
  /** London dates as strings for cheap comparisons. */
  fromDate: string;
  toDate: string;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

export interface ScrapeContext {
  source: Source;
  http: Http;
  browser: BrowserPool;
  horizon: Horizon;
  log: Logger;
  /** Is this start past the scrape horizon (i.e. we can stop paginating)? */
  isBeyondHorizon(when: DateLike): boolean;
  /** Is this start before today (e.g. a listing that still shows today's earlier events)? */
  isBeforeHorizon(when: DateLike): boolean;
  /** Inside the scrape window — worth fetching a detail page for. */
  inWindow(when: DateLike): boolean;
}

export type SourceStatus = "ok" | "empty" | "error";

export interface SourceHealth {
  id: string;
  name: string;
  homepage: string;
  status: SourceStatus;
  error: string | null;
  /** Events the scraper returned. */
  scraped: number;
  /** Events that survived validation + window filters. */
  kept: number;
  /** Events in the final output (after cross-source dedupe). */
  count: number;
  dropped: Record<string, number>;
  /** A few examples of dropped events (not past/beyond-horizon), for debugging filters. */
  dropSamples: string[];
  requests: number;
  durationMs: number;
  warnings: string[];
  /** When the source last scraped successfully: this run, or an earlier one if this run failed. */
  lastOkAt: string | null;
  /** Events shown from the last good scrape because this run failed (before cross-source dedupe). */
  carried: number;
}

/**
 * A source's last good scrape: its normalized events, before cross-source
 * de-duplication. Published as data/sources/<id>.json; when a later run of
 * the source fails, its still-upcoming events are shown from here.
 */
export interface SourceSnapshot {
  id: string;
  scrapedAt: string;
  events: EventRecord[];
}

export interface RunSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  horizonDays: number;
  totals: {
    sources: number;
    ok: number;
    empty: number;
    failed: number;
    events: number;
    duplicatesRemoved: number;
  };
  sources: SourceHealth[];
}

/** One line of the rolling run history (kept small: it ships to the browser). */
export interface HistoryEntry {
  at: string;
  ok: number;
  empty: number;
  failed: number;
  events: number;
  /** Per-source final counts; -1 = errored, 0 = empty. */
  counts: Record<string, number>;
}
