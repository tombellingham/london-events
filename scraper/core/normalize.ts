/**
 * RawEvent (whatever a scraper could extract) → EventRecord (strict, clean,
 * classified), or a reason for dropping it. Keeping every rule here means each
 * scraper only has to worry about *finding* data, not policing it.
 */

import { createHash } from "node:crypto";
import type { EventRecord, Horizon, LondonDateTime, RawEvent, Source } from "./types.ts";
import { daysBetween, fromLondon, isValidDate, toLondonDateTime } from "./dates.ts";
import { clean, htmlToText, speakersFromTitle, stripWrappingQuotes, truncate, uniqNames, unshout } from "./text.ts";
import { classifyFree, classifyOnline, isOutsideLondon } from "./classify.ts";

export const DESCRIPTION_MAX = 420;
/**
 * Anything running longer than this many days (inclusive) is an exhibition or
 * a course, not a talk. A conference of up to a week stays in.
 */
export const MAX_RUN_DAYS = 7;

export type DropReason =
  | "invalid"
  | "past"
  | "beyond-horizon"
  | "long-run"
  | "not-a-talk"
  | "online-only"
  | "outside-london"
  | "cancelled"
  | "members-only"
  | "excluded";

export type NormalizeResult = { ok: true; event: EventRecord } | { ok: false; reason: DropReason; detail?: string };

const STATUS_WORDS = String.raw`sold[\s-]*out|fully[\s-]*booked|cancell?ed|postponed|waiting[\s-]*list(?:\s+only)?|last\s+few(?:\s+tickets)?|few\s+tickets\s+left|new\s+date|rescheduled|extra\s+date|date\s+added|now\s+online|new`;
const STATUS_MARKERS = [
  new RegExp(String.raw`^\s*[*[(]*\s*(?:${STATUS_WORDS})\s*[*\])]*\s*[:\-–—|!]+\s*`, "i"),
  new RegExp(String.raw`^\s*[*[(]+\s*(?:${STATUS_WORDS})\s*[*\])]+\s*`, "i"),
  new RegExp(String.raw`\s*[-–—|:]?\s*[*[(]+\s*(?:${STATUS_WORDS})\s*[*\])]+\s*$`, "i"),
  new RegExp(String.raw`\s*[-–—|]\s*(?:${STATUS_WORDS})\s*!?\s*$`, "i"),
  new RegExp(String.raw`\*+\s*(?:${STATUS_WORDS})\s*\*+`, "gi"),
];
const CANCELLED = /(?:^|[*[(\s:|–—-])(?:cancell?ed|postponed)(?:$|[*\])\s:!|–—-])/i;

/** Strips "*SOLD OUT*", "CANCELLED:", "– Last few tickets" style markers; reports cancellation. */
export function cleanTitleWithStatus(raw: string): { title: string; cancelled: boolean } {
  let title = clean(htmlToText(raw));
  let cancelled = false;
  for (const re of STATUS_MARKERS) {
    title = title.replace(re, (marker) => {
      if (CANCELLED.test(marker)) cancelled = true;
      return " ";
    }).trim();
  }
  title = stripWrappingQuotes(unshout(title));
  title = title.replace(/\s+([:,.!?])/g, "$1").replace(/[\s|–—-]+$/, "").trim();
  return { title, cancelled };
}

export function cleanTitle(raw: string): string {
  return cleanTitleWithStatus(raw).title;
}

const FORMAT_PREFIX = /^\s*(in[\s-]?person(?:\s+only)?|online(?:\s+only)?|hybrid|virtual|live[\s-]?stream(?:ed)?)\s*(?::|\||–|—|-)\s+/i;
const FORMAT_SUFFIX = /\s*(?:[[(]\s*(online(?:\s+(?:only|event))?|in[\s-]?person|hybrid|virtual|live[\s-]?stream)\s*[\])]|[-–—|]\s*(online(?:\s+only)?|in[\s-]?person|hybrid))\s*$/i;

/** "In-Person Only: Talk" / "Talk [online]" → { title: "Talk", format: "in-person" | "online" }. */
export function splitFormatMarker(title: string): { title: string; online: boolean | null } {
  let t = title;
  let marker: string | null = null;
  const prefix = t.match(FORMAT_PREFIX);
  if (prefix) {
    marker = prefix[1];
    t = t.slice(prefix[0].length);
  }
  const suffix = t.match(FORMAT_SUFFIX);
  if (suffix) {
    marker ??= suffix[1] ?? suffix[2];
    t = t.slice(0, suffix.index);
  }
  if (!marker || t.trim().length < 3) return { title, online: null };
  const online = /^(?:online|virtual|live)/i.test(marker) ? true : false;
  return { title: t.trim(), online };
}

function asLondon(value: LondonDateTime | Date | null | undefined): LondonDateTime | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : toLondonDateTime(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.date ?? "");
  if (!m || !isValidDate(+m[1], +m[2], +m[3])) return null;
  const time = value.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) ? value.time : null;
  return { date: value.date, time };
}

function absoluteUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const ONLINE_IN_TITLE = /\[online\]|\(online\)|\bonline:\s|:\s*online\b|\s[-–—]\s*online\b|\bwebinar\b|\blive\s?stream\b|\bvirtual\s+(?:event|talk|lecture)\b/i;

/**
 * Exhibitions and courses that are listed one day at a time (so no end date
 * gives them away): "Bringing It Home Exhibition", "A 4-week course". A talk
 * about one ("Exhibition talk", "exhibition launch and lecture") stays.
 */
export function isExhibitionOrCourse(title: string): boolean {
  if (!/\bexhibitions?\b|(?<!\b(?:of|golf|main|race|crash)\s)\bcourses?\b(?!\s+of\b)/i.test(title)) return false;
  return !/\b(?:talks?|lectures?|launch|tours?|conversations?|discussions?|panels?|debates?|seminars?|symposium|q\s?&\s?a|readings?|in\s+focus)\b/i.test(title);
}

/** Events restricted to a society's members/fellows/friends aren't public listings. */
export function isMembersOnly(title: string, description: string): boolean {
  if (/\b(?:members|fellows|friends)(?:\s+of\s+(?:the\s+)?[\w&]+)?['’]?\s*(?:\(only\)|only\b)|\bfellows['’]\s+(?:tour|evening|meeting|event|drinks)\b/i.test(title)) return true;
  const lead = htmlToText(description).slice(0, 400);
  return /\b(?:for|open to)\s+(?:members|fellows)\s+only\b|\b(?:members|fellows)[\s-]only\s+(?:event|lecture|tour|meeting)\b|\bin person and members only\b|\bthis (?:event|tour|lecture) is (?:for|open to) (?:members|fellows)\b/i.test(lead);
}

/**
 * Re-applies the rules to an event normalized on an earlier run (a failed
 * source's last good scrape), in case they have changed since.
 */
export function stillListable(event: EventRecord, source: Source, horizon: Horizon): boolean {
  return (
    event.date >= horizon.fromDate &&
    event.date < horizon.toDate &&
    event.online !== true &&
    !isOutsideLondon(event.location) &&
    !isExhibitionOrCourse(event.title) &&
    !isMembersOnly(event.title, event.description ?? "") &&
    (!source.include || source.include(event))
  );
}

export function eventId(source: string, url: string, date: string, time: string | null): string {
  return createHash("sha1").update(`${source}|${url}|${date}|${time ?? ""}`).digest("hex").slice(0, 12);
}

export function normalizeEvent(raw: RawEvent, source: Source, horizon: Horizon): NormalizeResult {
  const status = cleanTitleWithStatus(raw.title ?? "");
  const { cancelled } = status;
  const marked = splitFormatMarker(status.title);
  const title = marked.title;
  if (title.length < 3) return { ok: false, reason: "invalid", detail: "missing title" };
  if (cancelled) return { ok: false, reason: "cancelled", detail: title };

  const url = absoluteUrl(raw.url ?? "");
  if (!url) return { ok: false, reason: "invalid", detail: `bad url for "${title}"` };

  const parsed = asLondon(raw.start);
  if (!parsed) return { ok: false, reason: "invalid", detail: `bad date for "${title}"` };
  // Midnight is what CMSs store for "no time given"; no talk starts at 00:00.
  const start: LondonDateTime = parsed.time === "00:00" ? { date: parsed.date, time: null } : parsed;

  const end = asLondon(raw.end ?? null);
  if (end && daysBetween(start.date, end.date) + 1 > MAX_RUN_DAYS) {
    return { ok: false, reason: "long-run", detail: title };
  }

  if (start.date < horizon.fromDate) return { ok: false, reason: "past" };
  if (isMembersOnly(title, raw.description ?? "")) return { ok: false, reason: "members-only", detail: title };
  if (start.date >= horizon.toDate) return { ok: false, reason: "beyond-horizon" };
  if (isExhibitionOrCourse(title)) return { ok: false, reason: "not-a-talk", detail: title };

  const fullDescription = htmlToText(raw.description ?? "");
  let description: string | null = fullDescription;
  if (!description || description.toLowerCase() === title.toLowerCase()) description = null;
  else description = truncate(description, DESCRIPTION_MAX);

  let location: string | null = clean(htmlToText(raw.location ?? "")) || null;
  if (location && location.length > 160) location = truncate(location, 160);

  const priceClean = clean((raw.priceText ?? "").replace(/https?:\/\/\S+/g, " "));
  const priceText = priceClean ? truncate(priceClean, 90) : null;
  const hints = (raw.hints ?? []).map(clean).filter(Boolean);

  // Free / paid.
  let free: boolean | null = typeof raw.free === "boolean" ? raw.free : null;
  if (free === null) free = classifyFree({ priceText, texts: [fullDescription, ...hints] });
  if (free === null && typeof source.defaults?.free === "boolean") free = source.defaults.free;

  // Online / in person (hybrid counts as in person).
  let online: boolean | null = typeof raw.online === "boolean" ? raw.online : marked.online;
  // An explicit "(Online)" / "[online]" marker in the title beats a venue field (often a default).
  if (online === null && ONLINE_IN_TITLE.test(title) && !/\b(?:hybrid|in[\s-]person)\b/i.test(location ?? "")) online = true;
  if (online === null) online = classifyOnline({ location });
  if (online === null) online = classifyOnline({ texts: [...hints, fullDescription] });
  if (online === null && typeof source.defaults?.online === "boolean") online = source.defaults.online;
  // A source with a home venue and no online signal anywhere: it's at the venue.
  if (online === null && !location && source.defaults?.location) online = false;

  // In-person London events only (hybrid ones count as in person).
  if (online === true) return { ok: false, reason: "online-only", detail: title };
  if (!location && source.defaults?.location) location = source.defaults.location;
  if (isOutsideLondon(location)) return { ok: false, reason: "outside-london", detail: `${title} @ ${location}` };

  // Sources without speaker data get the (conservative) title reading: "X in
  // conversation with Y", "An evening with X", "X: Title" when X is clearly a person.
  const speakers = uniqNames(raw.speakers?.length ? raw.speakers : speakersFromTitle(title))
    .filter((s) => s.length >= 3 && s.length <= 80 && s.toLowerCase() !== title.toLowerCase())
    .slice(0, 12);

  const event: EventRecord = {
    id: eventId(source.id, url, start.date, start.time),
    source: source.id,
    title,
    url,
    date: start.date,
    time: start.time,
    start: fromLondon(start.date, start.time).toISOString(),
    location,
    description,
    speakers,
    free,
    online,
    price: priceText,
  };

  if (source.include && !source.include(event)) return { ok: false, reason: "excluded", detail: title };
  return { ok: true, event };
}
