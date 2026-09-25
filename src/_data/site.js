/**
 * Build-time data for the page: reads what `npm run scrape` wrote to .build/
 * and prepares (a) a few pre-rendered bits for the static shell and (b) the
 * JSON blob that ships to the browser, where all filtering happens.
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
  const sources = (blob?.sources ?? []).map((s) => {
    const h = healthById.get(s.id);
    return {
      id: s.id,
      name: s.name,
      homepage: s.homepage,
      status: h?.status ?? "unknown",
      count: h?.count ?? 0,
      scraped: h?.scraped ?? 0,
      error: h?.error ?? null,
      warnings: h?.warnings?.length ?? 0,
      seconds: h ? Math.round(h.durationMs / 100) / 10 : null,
    };
  });

  // Alphabetical, ignoring a leading "The" ("The Charterhouse" sorts under C).
  const sortKey = (name) => name.replace(/^the\s+/i, "").toLowerCase();
  sources.sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));

  const totals = health?.totals ?? { sources: sources.length, ok: 0, empty: 0, failed: 0, events: blob?.events?.length ?? 0 };

  // Everything the browser needs, in one inline JSON document. "<" is escaped
  // so nothing in an event title can terminate the <script> element early.
  const payload = {
    generatedAt: blob?.generatedAt ?? null,
    horizonDays: blob?.horizonDays ?? null,
    sources,
    events: blob?.events ?? [],
    history: (history ?? []).slice(-60),
  };

  return {
    generatedAt: blob?.generatedAt ?? null,
    generatedLabel: blob?.generatedAt ? londonLabel(blob.generatedAt) : null,
    totals,
    sources,
    failedSources: sources.filter((s) => s.status === "error"),
    emptySources: sources.filter((s) => s.status === "empty"),
    eventCount: payload.events.length,
    payloadJson: JSON.stringify(payload).replace(/</g, "\\u003c"),
  };
}
