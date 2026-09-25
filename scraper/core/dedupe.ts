/**
 * De-duplication, in two passes:
 *
 * 1. Exact: same normalized URL on the same London date (a page that lists
 *    one event twice, overlapping listing pages, two sources pointing at one
 *    Eventbrite page…). Recurring events that share a URL but run on
 *    different days are kept — they are genuinely different occurrences.
 *
 * 2. Cross-source: different URLs, but the same event at the same time with
 *    near-identical titles (e.g. a Fortean Society talk that Conway Hall also
 *    lists). The richer record wins and remembers the others in `alsoAt`.
 */

import type { EventRecord } from "./types.ts";

const TRACKING_PARAM = /^(?:utm_[a-z]+|aff|ref|referrer|source|fbclid|gclid|dclid|msclkid|mc_[a-z]+|_gl|_ga|campaign|cmp|intcmp|kw|hsa_[a-z]+)$/i;

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    u.protocol = "https:";
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAM.test(k)).sort(([a], [b]) => a.localeCompare(b));
    u.search = params.length ? `?${new URLSearchParams(params).toString()}` : "";
    let path = u.pathname.replace(/\/{2,}/g, "/");
    if (path.length > 1) path = path.replace(/\/+$/, "");
    u.pathname = path;
    return u.toString().toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** How much useful information a record carries — used to pick survivors. */
export function richness(e: EventRecord): number {
  return (
    (e.time ? 4 : 0) +
    (e.location && e.location !== "Online" ? 2 : 0) +
    Math.min((e.description?.length ?? 0) / 80, 4) +
    Math.min(e.speakers.length, 3) +
    (e.free !== null ? 1 : 0) +
    (e.online !== null ? 1 : 0) +
    (e.price ? 1 : 0)
  );
}

/** Fill gaps in `keep` from `other` (never overwriting). */
function mergeInto(keep: EventRecord, other: EventRecord): void {
  keep.time ??= other.time;
  keep.location ??= other.location;
  keep.description ??= other.description;
  if (keep.speakers.length === 0) keep.speakers = other.speakers;
  keep.free ??= other.free;
  keep.online ??= other.online;
  keep.price ??= other.price;
}

export interface DedupeResult {
  events: EventRecord[];
  exactDuplicates: number;
  crossSourceDuplicates: number;
}

const STOPWORDS = new Set(
  "a an the and or of in on at to for with from by is are be as its it this that into about how why what who when live talk talks lecture lectures event events online in-person evening afternoon morning conversation book launch presents special annual public free new".split(" "),
);

export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/['’]s\b/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
  );
}

export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const jaccard = shared / (ta.size + tb.size - shared);
  // One title fully containing the other ("X" vs "X: the subtitle") is strong evidence too.
  const containment = shared / Math.min(ta.size, tb.size);
  return Math.min(ta.size, tb.size) >= 3 ? Math.max(jaccard, containment * 0.9) : jaccard;
}

function timesCompatible(a: EventRecord, b: EventRecord): boolean {
  if (!a.time || !b.time) return true;
  const [ah, am] = a.time.split(":").map(Number);
  const [bh, bm] = b.time.split(":").map(Number);
  return Math.abs(ah * 60 + am - (bh * 60 + bm)) <= 30;
}

const GENERIC_PLACE = new Set("london the of and at room rooms hall building house street road centre center theatre lecture main floor level online uk".split(" "));

function placeTokens(location: string): Set<string> {
  return new Set(
    location
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 2 && !GENERIC_PLACE.has(w) && !/^\d/.test(w)),
  );
}

function locationsCompatible(a: EventRecord, b: EventRecord): boolean {
  if (!a.location || !b.location || a.online || b.online) return true;
  const ta = placeTokens(a.location);
  const tb = placeTokens(b.location);
  if (ta.size === 0 || tb.size === 0) return true;
  for (const t of ta) if (tb.has(t)) return true;
  return false;
}

/**
 * Are these two records the same real-world event? Across sources we allow
 * some title variation; within one source (a site syndicating an event to
 * several department pages under different URLs) titles must be near-identical
 * and the start time exact.
 */
export function isSameEvent(a: EventRecord, b: EventRecord): boolean {
  if (a.date !== b.date || !timesCompatible(a, b)) return false;
  if (Math.min(titleTokens(a.title).size, titleTokens(b.title).size) < 2) return false;
  const similarity = titleSimilarity(a.title, b.title);
  if (a.source === b.source) return a.time === b.time && similarity >= 0.95;
  return similarity >= 0.8 && locationsCompatible(a, b);
}

export function dedupe(events: EventRecord[]): DedupeResult {
  // Pass 1: exact URL + date.
  const byKey = new Map<string, EventRecord>();
  let exactDuplicates = 0;
  for (const event of events) {
    const key = `${normalizeUrl(event.url)}|${event.date}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...event, speakers: [...event.speakers] });
      continue;
    }
    exactDuplicates++;
    const [keep, drop] = richness(event) > richness(existing) ? [{ ...event, speakers: [...event.speakers] }, existing] : [existing, event];
    mergeInto(keep, drop);
    // Keep the earliest start if the same page lists two sessions that day.
    if (drop.time && keep.time && drop.time < keep.time) {
      keep.time = drop.time;
      keep.start = drop.start;
    }
    if (drop.source !== keep.source) {
      keep.alsoAt = [...(keep.alsoAt ?? []), { source: drop.source, url: drop.url }];
    }
    byKey.set(key, keep);
  }

  // Pass 2: cross-source fuzzy matches on the same day.
  const byDate = new Map<string, EventRecord[]>();
  for (const e of byKey.values()) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }
  let crossSourceDuplicates = 0;
  const out: EventRecord[] = [];
  for (const dayEvents of byDate.values()) {
    const removed = new Set<EventRecord>();
    for (let i = 0; i < dayEvents.length; i++) {
      const a = dayEvents[i];
      if (removed.has(a)) continue;
      for (let j = i + 1; j < dayEvents.length; j++) {
        const b = dayEvents[j];
        if (removed.has(b) || !isSameEvent(a, b)) continue;
        const [keep, drop] = richness(b) > richness(a) ? [b, a] : [a, b];
        mergeInto(keep, drop);
        if (drop.source !== keep.source) keep.alsoAt = [...(keep.alsoAt ?? []), { source: drop.source, url: drop.url }];
        if (drop.alsoAt?.length) keep.alsoAt = [...(keep.alsoAt ?? []), ...drop.alsoAt];
        removed.add(drop);
        crossSourceDuplicates++;
        if (drop === a) break;
      }
    }
    out.push(...dayEvents.filter((e) => !removed.has(e)));
  }

  out.sort((x, y) => x.start.localeCompare(y.start) || x.title.localeCompare(y.title));
  return { events: out, exactDuplicates, crossSourceDuplicates };
}
