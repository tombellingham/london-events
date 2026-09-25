/**
 * Deterministic data for the browser tests. The tests pin the page clock to
 * NOW (Thursday 1 October 2026, 10:30 London), so "today", "tomorrow" and the
 * 7/30-day windows below are stable.
 */

import { fromLondon } from "../../scraper/core/dates.ts";

export const NOW = new Date("2026-10-01T09:30:00Z"); // 10:30 BST

const sources = [
  { id: "alpha", name: "Alpha Institute", homepage: "https://alpha.example/events" },
  { id: "beta", name: "The Beta Society", homepage: "https://beta.example/whats-on" },
  { id: "gamma", name: "Gamma College", homepage: "https://gamma.example/events" },
];

let n = 0;
function event(source: string, date: string, time: string | null, title: string, extra: Record<string, unknown> = {}) {
  n++;
  return {
    id: n.toString(16).padStart(12, "0"),
    source,
    title,
    url: `https://${source}.example/events/${n}`,
    date,
    time,
    start: fromLondon(date, time).toISOString(),
    location: "Senate House, Malet Street, WC1E 7HU",
    description: null,
    speakers: [],
    free: null,
    online: false,
    price: null,
    ...extra,
  };
}

export const events = [
  event("alpha", "2026-10-01", "10:00", "Morning lecture on maps", { free: true, description: "Cartography through the ages." }),
  event("beta", "2026-10-01", "19:00", "Evening debate on rivers", { free: false, price: "£10 / £8 concessions", speakers: ["Jane Doe", "Dr John Roe"] }),
  event("alpha", "2026-10-02", "18:30", "Online seminar: stars", { free: true, online: true, location: "Online" }),
  event("alpha", "2026-10-02", null, "All-day symposium on soil", { free: true }),
  event("beta", "2026-10-06", "19:00", "Élan vital: a talk on Bergson", { free: false, price: "£12", alsoAt: [{ source: "alpha", url: "https://alpha.example/events/elan" }] }),
  event("alpha", "2026-10-20", "18:00", "Autumn lecture", { free: true }),
  event("beta", "2026-11-15", "19:00", "Beyond the thirty-day window", { free: false }),
].sort((a, b) => a.start.localeCompare(b.start));

const count = (id: string) => events.filter((e) => e.source === id).length;

export const blob = { generatedAt: "2026-10-01T04:30:00.000Z", horizonDays: 45, sources, events };

export const health = {
  startedAt: "2026-10-01T04:28:00.000Z",
  finishedAt: "2026-10-01T04:30:00.000Z",
  durationMs: 120000,
  horizonDays: 45,
  totals: { sources: 3, ok: 2, empty: 0, failed: 1, events: events.length, duplicatesRemoved: 1 },
  sources: [
    { id: "alpha", name: "Alpha Institute", homepage: sources[0].homepage, status: "ok", error: null, scraped: 6, kept: count("alpha"), count: count("alpha"), dropped: {}, dropSamples: [], requests: 3, durationMs: 1200, warnings: [] },
    { id: "beta", name: "The Beta Society", homepage: sources[1].homepage, status: "ok", error: null, scraped: 3, kept: count("beta"), count: count("beta"), dropped: {}, dropSamples: [], requests: 2, durationMs: 800, warnings: [] },
    { id: "gamma", name: "Gamma College", homepage: sources[2].homepage, status: "error", error: "Blocked by Cloudflare bot protection", scraped: 0, kept: 0, count: 0, dropped: {}, dropSamples: [], requests: 1, durationMs: 35000, warnings: [] },
  ],
};

export const history = [
  { at: "2026-09-29T04:30:00.000Z", ok: 3, empty: 0, failed: 0, events: 9, counts: { alpha: 5, beta: 3, gamma: 1 } },
  { at: "2026-09-30T04:30:00.000Z", ok: 2, empty: 1, failed: 0, events: 8, counts: { alpha: 5, beta: 3, gamma: 0 } },
  { at: "2026-10-01T04:30:00.000Z", ok: 2, empty: 0, failed: 1, events: events.length, counts: { alpha: count("alpha"), beta: count("beta"), gamma: -1 } },
];
