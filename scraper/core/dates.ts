/**
 * Europe/London date helpers.
 *
 * Every source ultimately describes events in London wall-clock time, but
 * they encode it inconsistently: proper ISO instants, naive "2026-09-28
 * 19:00:00" strings, ISO strings with a *wrong* offset ("19:00+00:00" for a
 * 7pm BST talk), or plain prose ("Tuesday 29 September, 7.30pm"). These
 * helpers convert between wall-clock and instants without ever depending on
 * the timezone of the machine running the scrape (CI is UTC; laptops aren't).
 */

import type { LondonDateTime } from "./types.ts";

const TZ = "Europe/London";

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

export interface LondonParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
}

export function londonParts(instant: Date): LondonParts {
  const parts = partsFormatter.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** London calendar date of an instant, as YYYY-MM-DD. */
export function londonDate(instant: Date): string {
  const p = londonParts(instant);
  return formatDate(p.year, p.month, p.day);
}

/** London wall-clock time of an instant, as HH:MM. */
export function londonTime(instant: Date): string {
  const p = londonParts(instant);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function toLondonDateTime(instant: Date): LondonDateTime {
  return { date: londonDate(instant), time: londonTime(instant) };
}

/** Minutes London is ahead of UTC at the given instant (0 in winter, 60 in summer). */
export function londonOffsetMinutes(instant: Date): number {
  const p = londonParts(instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const truncated = Math.floor(instant.getTime() / 60_000) * 60_000;
  return Math.round((asUtc - truncated) / 60_000);
}

/**
 * London wall-clock → instant. London is always UTC+0 or UTC+1, so try both
 * offsets and keep whichever round-trips. On the autumn fall-back day an
 * ambiguous time (01:30 happens twice) resolves to the first, BST, reading;
 * on the spring-forward day a non-existent time (01:30) resolves to 02:30 BST.
 */
export function fromLondon(date: string, time?: string | null): Date {
  const [y, m, d] = date.split("-").map(Number);
  const hhmm = time ?? "00:00";
  const [hh, mm] = hhmm.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  for (const offsetMinutes of [60, 0]) {
    const candidate = new Date(naive - offsetMinutes * 60_000);
    if (londonDate(candidate) === date && londonTime(candidate) === hhmm) return candidate;
  }
  return new Date(naive);
}

/** Parses "YYYY-MM-DD HH:MM[:SS]" / "YYYY-MM-DDTHH:MM" *naive* strings as London wall-clock. */
export function parseNaiveLondon(raw: string): LondonDateTime | null {
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  if (!isValidDate(Number(y), Number(mo), Number(d))) return null;
  return { date: `${y}-${mo}-${d}`, time: h ? `${h}:${mi}` : null };
}

/**
 * Parses an ISO-8601 string that carries a trustworthy offset/Z into an instant.
 * Returns null for naive strings (use parseNaiveLondon for those).
 */
export function parseIsoInstant(raw: string): Date | null {
  const s = raw.trim();
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * For sources that stamp London wall-clock times with a bogus offset
 * ("2026-09-28T19:00:00+00:00" for a 7pm BST event): ignore the offset and
 * read the digits as London time.
 */
export function parseIsoAsLondonWallClock(raw: string): LondonDateTime | null {
  return parseNaiveLondon(raw.replace(/([zZ]|[+-]\d{2}:?\d{2})$/, ""));
}

export function isValidDate(y: number, m: number, d: number): boolean {
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return formatDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Human-readable parsing
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

export function monthNumber(name: string): number | null {
  return MONTHS[name.toLowerCase().replace(/\.$/, "")] ?? null;
}

const MONTH_RE =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";

/**
 * Year to use when a source omits it: the year that puts the date closest to
 * "now" without being more than ~2 months in the past (so a December scrape
 * reading "5 January" lands in the new year).
 */
export function inferYear(month: number, day: number, now: Date = new Date()): number {
  const today = londonParts(now);
  const candidates = [today.year - 1, today.year, today.year + 1];
  const todayStr = formatDate(today.year, today.month, today.day);
  let best = today.year;
  let bestScore = Infinity;
  for (const y of candidates) {
    if (!isValidDate(y, month, day)) continue;
    const diff = daysBetween(todayStr, formatDate(y, month, day));
    // Dates up to 60 days ago are plausible (still-running listings); beyond that prefer the future.
    const score = diff < -60 ? Infinity : Math.abs(diff);
    if (score < bestScore) {
      bestScore = score;
      best = y;
    }
  }
  return best;
}

/**
 * Finds the first calendar date in free text. Understands:
 *   2026-09-28 · 28/09/2026 · 28 September 2026 · Monday 28th Sept · 28 Sep
 *   September 28, 2026 · Sept 28 · Tue 6 Oct 2026, 6.30pm
 */
export function parseDate(text: string, now: Date = new Date()): string | null {
  const s = text.replace(/ /g, " ");

  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})(?!\d)/);
  if (m && isValidDate(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;

  // Day ranges inside one month ("12–15 July 2027", "28-29 Sept"): the start is the first day.
  m = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*[–—-]\\s*\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_RE}(?:,?\\s+(\\d{4}))?`, "i"));
  if (m) {
    const day = +m[1];
    const month = monthNumber(m[2])!;
    const year = m[3] ? +m[3] : inferYear(month, day, now);
    if (isValidDate(year, month, day)) return formatDate(year, month, day);
  }

  m = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?[\\s-]+${MONTH_RE}(?:,?[\\s-]+(\\d{4}))?`, "i"));
  if (m) {
    const day = +m[1];
    const month = monthNumber(m[2])!;
    const year = m[3] ? +m[3] : inferYear(month, day, now);
    if (isValidDate(year, month, day)) return formatDate(year, month, day);
  }

  m = s.match(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "i"));
  if (m) {
    const month = monthNumber(m[1])!;
    const day = +m[2];
    const year = m[3] ? +m[3] : inferYear(month, day, now);
    if (isValidDate(year, month, day)) return formatDate(year, month, day);
  }

  m = s.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4}|\d{2})\b/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (isValidDate(year, +m[2], +m[1])) return formatDate(year, +m[2], +m[1]);
  }

  return null;
}

interface TimeToken {
  index: number;
  end: number;
  hour: number;
  minute: number;
  meridiem: "am" | "pm" | null;
  /** Written with a leading zero ("07:30") — explicit 24h notation. */
  zeroPadded: boolean;
}

const TIME_RE = new RegExp(
  [
    String.raw`\b(noon|midday|midnight)\b`,
    // 7pm · 7.30pm · 7:30 p.m. · 11 am   (never prices like £7.50)
    String.raw`(?<![£$€\d.,:])\b(1[0-2]|0?[1-9])(?:[:.]([0-5]\d))?\s*([ap])\.?\s?m\b\.?`,
    // 19:30 · 18.45 · 07:00   (not £12.50, 3.5 hours, 10.5%)
    String.raw`(?<![£$€\d.,:])\b([01]\d|2[0-3]|\d)[:.]([0-5]\d)(?::[0-5]\d)?\b(?![.:,]?\d)(?!\s*(?:%|per\s*cent|hours?|hrs?|mins?|minutes?|km|miles?|million|bn|[mk]\b))`,
    // A bare hour opening a range that ends with am/pm: the "11" of "11-1pm", the "6" of "6 – 8pm".
    String.raw`(?<![£$€\d.,:])\b(1[0-2]|0?[1-9])(?=\s*(?:-|–|—|to|until)\s*(?:1[0-2]|0?[1-9])(?:[:.][0-5]\d)?\s*[ap]\.?\s?m\b)`,
  ].join("|"),
  "gi",
);

function tokenizeTimes(text: string): TimeToken[] {
  const tokens: TimeToken[] = [];
  for (const m of text.matchAll(TIME_RE)) {
    const index = m.index ?? 0;
    const end = index + m[0].length;
    if (m[1]) {
      const word = m[1].toLowerCase();
      tokens.push({ index, end, hour: word === "midnight" ? 0 : 12, minute: 0, meridiem: word === "midnight" ? null : "pm", zeroPadded: true });
    } else if (m[2]) {
      const meridiem = m[4].toLowerCase() === "a" ? "am" : "pm";
      tokens.push({ index, end, hour: +m[2], minute: m[3] ? +m[3] : 0, meridiem, zeroPadded: false });
    } else if (m[5]) {
      tokens.push({ index, end, hour: +m[5], minute: +m[6], meridiem: null, zeroPadded: m[5].length === 2 && m[5].startsWith("0") });
    } else {
      tokens.push({ index, end, hour: +m[7], minute: 0, meridiem: null, zeroPadded: false });
    }
  }
  return tokens;
}

function to24(hour: number, meridiem: "am" | "pm" | null): number {
  if (meridiem === "am") return hour === 12 ? 0 : hour;
  if (meridiem === "pm") return hour === 12 ? 12 : hour + 12;
  return hour;
}

/**
 * Finds the *start* time in free text and returns HH:MM (24h).
 *   "7pm" · "7.30pm–9pm" · "6.30-8pm" (pm inherited) · "19:30" · "Doors 6.30pm, talk 7pm"
 * Times introduced by "doors" are skipped in favour of the next time, and a
 * bare "7.30" (no am/pm, no leading zero) is read as evening, as UK listings mean it.
 */
export function parseTime(text: string): string | null {
  const s = text.replace(/ /g, " ");
  const tokens = tokenizeTimes(s);
  if (tokens.length === 0) return null;

  const isDoors = (t: TimeToken) => /\bdoors?\b[^0-9]{0,14}$/i.test(s.slice(Math.max(0, t.index - 22), t.index));
  const pick = tokens.find((t) => !isDoors(t)) ?? tokens[0];
  let meridiem = pick.meridiem;

  if (meridiem === null && pick.hour >= 1 && pick.hour <= 12 && !pick.zeroPadded) {
    // "6.30-8pm": inherit the meridiem of a range end that follows immediately.
    const next = tokens.find((t) => t.index > pick.index);
    if (next?.meridiem && /^\s*(?:-|–|—|to|until|till)\s*$/i.test(s.slice(pick.end, next.index))) {
      meridiem = to24(pick.hour, next.meridiem) <= to24(next.hour, next.meridiem) ? next.meridiem : "am";
    } else if (pick.hour <= 7) {
      meridiem = "pm";
    }
  }

  const hour = to24(pick.hour, meridiem);
  if (hour > 23) return null;
  return `${pad(hour)}:${pad(pick.minute)}`;
}

/** Date + optional start time from one free-text string. */
export function parseDateTime(text: string, now: Date = new Date()): LondonDateTime | null {
  const date = parseDate(text, now);
  if (!date) return null;
  // Don't let the day-of-month ("28 Sep") be mistaken for a time: strip the date portion first.
  const withoutDates = text
    .replace(/\b\d{4}-\d{2}-\d{2}(?:T(?=\d))?/g, " ")
    .replace(/\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g, " ");
  return { date, time: parseTime(withoutDates) };
}
