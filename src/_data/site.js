/**
 * Build-time data for both pages: reads what `npm run scrape` wrote to .build/
 * and prepares (a) the JSON blob that ships to the events page, where all
 * filtering happens, and (b) everything the (static) status page shows.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUILD = process.env.BUILD_DIR ?? join(ROOT, ".build");

function readJson(name, fallback) {
  const file = join(BUILD, name);
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.warn(`⚠ Could not parse ${file}: ${err.message}`);
    return fallback;
  }
}

/** "Blocked by … at https://www.iop.org/events (challenge did not clear…)" → "Blocked by … at www.iop.org". */
function shortError(message) {
  if (!message) return null;
  return message
    .replace(/https?:\/\/([^/\s)]+)[^\s)]*/g, "$1")
    .replace(/\s*\((?:challenge did not clear[^)]*|in-page fetch[^)]*)\)/g, "")
    .trim();
}

const dayLabel = (iso) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
const shortDay = (iso) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" }).format(new Date(iso));

/** 514_000 → "8 min 34 s". */
function durationLabel(ms) {
  if (!Number.isFinite(ms)) return null;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** Sparkline bars: heights relative to the largest value; failures (-1) full height. */
function spark(points) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return points.map((p) => ({ cls: p.cls, title: p.title, height: p.value < 0 ? 100 : Math.max(8, Math.round((p.value / max) * 100)) }));
}

/** How many runs the sparklines cover. */
const RECENT_RUNS = 30;

const londonLabel = (iso) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));

export default function () {
  const blob = readJson("events.json", null);
  const health = readJson("health.json", null);
  const history = readJson("history.json", []);

  if (!blob) {
    console.warn(`⚠ ${join(BUILD, "events.json")} not found — run \`npm run scrape\` first. Building an empty page.`);
  }

  const healthById = new Map((health?.sources ?? []).map((s) => [s.id, s]));
  const runs = (Array.isArray(history) ? history : []).slice(-RECENT_RUNS);
  const sources = (blob?.sources ?? []).map((s) => {
    const h = healthById.get(s.id);
    // Runs from before a source existed have no count for it; skip those.
    const known = runs.filter((r) => r.counts && s.id in r.counts);
    return {
      id: s.id,
      name: s.name,
      homepage: s.homepage,
      status: h?.status ?? "unknown",
      count: h?.count ?? 0,
      scraped: h?.scraped ?? 0,
      error: h?.error ?? null,
      errorShort: shortError(h?.error),
      warnings: h?.warnings ?? [],
      droppedLabel: Object.entries(h?.dropped ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([reason, n]) => `${reason} ${n}`)
        .join(", "),
      seconds: h ? Math.round(h.durationMs / 1000) : null,
      lastOkLabel: h?.lastOkAt ? dayLabel(h.lastOkAt) : null,
      // A failed source listing events from its last good scrape.
      carriedFrom: h?.status === "error" && h?.carried && h?.lastOkAt ? dayLabel(h.lastOkAt) : null,
      bars: spark(
        known.map((r) => {
          const c = r.counts[s.id];
          return { value: c, cls: c < 0 ? "bad" : c === 0 ? "warn" : "", title: `${shortDay(r.at)}: ${c < 0 ? "failed" : `${c} events`}` };
        }),
      ),
    };
  });

  // Alphabetical, ignoring a leading "The" ("The Charterhouse" sorts under C).
  const sortKey = (name) => name.replace(/^the\s+/i, "").toLowerCase();
  sources.sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));

  const totals = health?.totals ?? { sources: sources.length, ok: 0, empty: 0, failed: 0, events: blob?.events?.length ?? 0 };

  // Everything the events page needs, in one inline JSON document. "<" is
  // escaped so nothing in an event title can terminate the <script> early.
  const payload = {
    sources: sources.map(({ id, name }) => ({ id, name })),
    events: blob?.events ?? [],
  };

  const run = {
    duration: durationLabel(health?.durationMs),
    sparkLabel: runs.length === 1 ? "Events listed after the last run" : `Events listed after each of the last ${runs.length} runs`,
    duplicatesRemoved: health?.totals?.duplicatesRemoved ?? 0,
    bars: spark(
      runs.map((r, i) => ({
        value: r.events,
        cls: [r.failed ? "bad" : r.empty ? "warn" : "", i === runs.length - 1 ? "last" : ""].filter(Boolean).join(" "),
        title: `${shortDay(r.at)}: ${r.events} events, ${r.ok} ok, ${r.empty} empty, ${r.failed} failed`,
      })),
    ),
  };

  return {
    generatedAt: blob?.generatedAt ?? null,
    generatedLabel: blob?.generatedAt ? londonLabel(blob.generatedAt) : null,
    totals,
    sources,
    failedSources: sources.filter((s) => s.status === "error"),
    run,
    sampleSnapshot: sources.find((s) => s.lastOkLabel)?.id ?? null,
    eventCount: payload.events.length,
    payloadJson: JSON.stringify(payload).replace(/</g, "\\u003c"),
  };
}
