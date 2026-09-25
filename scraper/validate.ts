/**
 * Sanity checks on .build/*.json before anything is published. A failure
 * here stops the deploy, so the live site keeps yesterday's data instead of
 * showing something broken. Individual sources failing is *not* a failure
 * (that's what the health report is for) — only structural problems or a
 * collapse in the overall numbers are.
 *
 *   npm run validate            # after npm run scrape
 *   MIN_EVENTS=0 npm run validate   # e.g. for a partial --only scrape
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { addDays, fromLondon, londonDate } from "./core/dates.ts";
import { normalizeUrl } from "./core/dedupe.ts";
import type { EventRecord, HistoryEntry, RunSummary } from "./core/types.ts";

const BUILD = process.env.BUILD_DIR ?? join(process.cwd(), ".build");
const MIN_EVENTS = Number(process.env.MIN_EVENTS ?? 100);
const MIN_OK_SHARE = Number(process.env.MIN_OK_SHARE ?? 0.5);

interface Blob {
  generatedAt: string;
  horizonDays: number;
  sources: Array<{ id: string; name: string; homepage: string }>;
  events: EventRecord[];
}

const errors: string[] = [];
const fail = (msg: string) => errors.push(msg);

function read<T>(name: string): T | null {
  const file = join(BUILD, name);
  if (!existsSync(file)) {
    fail(`${name} is missing`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (err) {
    fail(`${name} is not valid JSON: ${String(err)}`);
    return null;
  }
}

const blob = read<Blob>("events.json");
const health = read<RunSummary>("health.json");
const history = read<HistoryEntry[]>("history.json");

if (blob) {
  const ids = new Set(blob.sources.map((s) => s.id));
  if (!Number.isFinite(Date.parse(blob.generatedAt))) fail("generatedAt is not a timestamp");
  if (!Array.isArray(blob.events)) fail("events is not an array");

  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  let previousStart = "";
  for (const [i, e] of (blob.events ?? []).entries()) {
    const where = `event #${i} (${e.source}: ${e.title?.slice(0, 50)})`;
    if (!/^[0-9a-f]{12}$/.test(e.id)) fail(`${where}: bad id ${e.id}`);
    if (seenIds.has(e.id)) fail(`${where}: duplicate id ${e.id}`);
    seenIds.add(e.id);
    if (!ids.has(e.source)) fail(`${where}: unknown source`);
    if (!e.title || e.title.length < 3 || /<[a-z/]/i.test(e.title)) fail(`${where}: bad title`);
    if (!/^https?:\/\//.test(e.url)) fail(`${where}: bad url ${e.url}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) fail(`${where}: bad date ${e.date}`);
    if (e.time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time)) fail(`${where}: bad time ${e.time}`);
    if (e.start !== fromLondon(e.date, e.time).toISOString()) fail(`${where}: start ${e.start} disagrees with ${e.date} ${e.time}`);
    for (const key of ["free", "online"] as const) {
      if (e[key] !== null && typeof e[key] !== "boolean") fail(`${where}: ${key} must be boolean or null`);
    }
    if (!Array.isArray(e.speakers)) fail(`${where}: speakers must be an array`);
    if (e.description && e.description.length > 500) fail(`${where}: description too long`);
    const key = `${normalizeUrl(e.url)}|${e.date}`;
    if (seenKeys.has(key)) fail(`${where}: duplicate URL on the same day`);
    seenKeys.add(key);
    if (e.start < previousStart) fail(`${where}: events are not sorted by start`);
    previousStart = e.start;
  }

  const firstDate = blob.events[0]?.date;
  const yesterday = addDays(londonDate(new Date(blob.generatedAt)), -1);
  if (firstDate && firstDate < yesterday) fail(`events start in the past (${firstDate})`);
  if (blob.events.length < MIN_EVENTS) fail(`only ${blob.events.length} events (expected at least ${MIN_EVENTS})`);
}

if (health && blob) {
  const t = health.totals;
  if (t.sources !== health.sources.length) fail("health totals disagree with the per-source list");
  if (t.events !== blob.events.length) fail(`health says ${t.events} events, events.json has ${blob.events.length}`);
  if (t.sources > 1 && t.ok / t.sources < MIN_OK_SHARE) fail(`only ${t.ok}/${t.sources} sources succeeded`);
  const counts = new Map<string, number>();
  for (const e of blob.events) counts.set(e.source, (counts.get(e.source) ?? 0) + 1);
  for (const s of health.sources) {
    if ((counts.get(s.id) ?? 0) !== s.count) fail(`${s.id}: health count ${s.count} ≠ ${counts.get(s.id) ?? 0} events`);
  }
}

if (history && !Array.isArray(history)) fail("history.json is not an array");

if (errors.length) {
  console.error(`✗ ${errors.length} validation error(s):`);
  for (const e of errors.slice(0, 50)) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✓ ${blob?.events.length} events from ${health?.totals.ok}/${health?.totals.sources} sources look good`);
