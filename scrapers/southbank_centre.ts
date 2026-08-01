/**
 * Adapter for Southbank Centre (southbankcentre.co.uk).
 *
 * No JSON feed or JSON-LD here either — dates come from a single <time>
 * element as human text, e.g. "Sat 22 Aug 2026, 7.45pm" (note: a period,
 * not a colon, separates hours/minutes — different convention to Seed
 * Talks' "7pm"/"7:30pm" style, so this gets its own parser rather than
 * reusing that one).
 */

import * as cheerio from "cheerio";
import type { Event } from "../types";
import { parseLondonDateTime } from "../dates";

const LISTING_URL =
  "https://www.southbankcentre.co.uk/whats-on/?artform-filter=talks-debates";
const SOURCE_NAME = "Southbank Centre";

// Auto-discovered by the aggregator's scrapers/ loader — must be exported
// by every adapter module.
export const name = SOURCE_NAME;

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export async function scrape(): Promise<Event[]> {
  const res = await fetch(LISTING_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; EventAggregator/1.0)" },
  });

  if (!res.ok) {
    throw new Error(
      `Southbank Centre listing returned ${res.status} ${res.statusText}`
    );
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const events: Event[] = [];

  $(".c-event-card").each((_, el) => {
    try {
      const card = $(el);

      const title = collapseWhitespace(
        card.find(".c-event-card__title").first().text()
      );
      const url = card.find(".c-event-card__cover-link").first().attr("href");
      if (!title || !url) return;

      const dateText = collapseWhitespace(
        card.find(".c-event-card__daterange").first().text()
      );
      const parsedDates = parseSouthbankDateRange(dateText);
      if (parsedDates.length === 0) return;

      const blurb = collapseWhitespace(
        card.find(".c-event-card__listing-details").first().text()
      );
      // The location span includes a Font Awesome <i> icon as its first
      // child; .text() already skips its (empty) content, but strip
      // leftover whitespace from where the icon sat.
      const location = collapseWhitespace(
        card.find(".c-event-card__location").first().text()
      );

      // Some cards list two (or more) dates joined by "&" for a
      // multi-night run, e.g. "Fri 4 Sep & Sat 5 Sep 2026" — each becomes
      // its own event, since the site groups listings by day.
      for (const { date, hasExplicitTime } of parsedDates) {
        const timeNote = hasExplicitTime
          ? ""
          : " (exact time not listed — check event page)";
        const description = location
          ? `${blurb} Location: ${location}.${timeNote}`
          : `${blurb}${timeNote}`;

        events.push({
          title,
          description: description.trim() || "A Southbank Centre event.",
          startDate: date,
          url,
          source: SOURCE_NAME,
        });
      }
    } catch {
      // isolate per-card failures; keep going
    }
  });

  return events;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

interface ParsedSouthbankDate {
  date: Date;
  hasExplicitTime: boolean;
}

// Fallback hour used only when a card gives no time anywhere (e.g. multi-
// night runs like "Fri 4 Sep & Sat 5 Sep 2026"). Southbank talks/debates
// events skew evening, so this is a reasonable placeholder — but every
// event that uses it also gets an explicit note in its description, since
// this is a guess, not a fact.
const FALLBACK_HOUR = 19;
const FALLBACK_MINUTE = 30;

/**
 * Parses date strings that take one of these shapes:
 *   "Sat 22 Aug 2026, 7.45pm"              — single date + time
 *   "Fri 4 Sep & Sat 5 Sep 2026"           — multiple dates, no time at all
 *   "Fri 4 Sep & Sat 5 Sep 2026, 7.45pm"   — multiple dates, time trailing
 *                                             (assumed to apply to all)
 *
 * Segments are split on "&". Only the last segment is required to carry
 * the year and (if present) the time — earlier segments borrow both from
 * the nearest later segment that has them, since that's how the site
 * writes multi-date runs. If no segment has a time at all, every date
 * falls back to FALLBACK_HOUR/MINUTE and is flagged via hasExplicitTime.
 */
function parseSouthbankDateRange(raw: string): ParsedSouthbankDate[] {
  const segments = raw.split("&").map((s) => s.trim());

  interface RawSegment {
    day: string;
    month: string;
    year: string | null;
    hour: string | null;
    minute: string | null;
    meridiem: string | null;
  }

  const parsedSegments: RawSegment[] = [];

  for (const segment of segments) {
    const match = segment.match(
      /^[A-Za-z]+\s+(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?(?:,\s*(\d{1,2})(?:\.(\d{2}))?\s*(am|pm))?$/i
    );
    if (!match) return []; // unrecognized shape entirely; bail out for this card

    const [, day, month, year, hour, minute, meridiem] = match;
    parsedSegments.push({
      day,
      month,
      year: year ?? null,
      hour: hour ?? null,
      minute: minute ?? null,
      meridiem: meridiem ?? null,
    });
  }

  // Backward-fill year and time from the nearest later segment that has them.
  for (let i = parsedSegments.length - 2; i >= 0; i--) {
    if (!parsedSegments[i].year) parsedSegments[i].year = parsedSegments[i + 1].year;
    if (!parsedSegments[i].hour) {
      parsedSegments[i].hour = parsedSegments[i + 1].hour;
      parsedSegments[i].minute = parsedSegments[i + 1].minute;
      parsedSegments[i].meridiem = parsedSegments[i + 1].meridiem;
    }
  }

  const results: ParsedSouthbankDate[] = [];

  for (const seg of parsedSegments) {
    const month = MONTHS[seg.month.toLowerCase()];
    if (!month || !seg.year) continue; // still missing required fields; skip this date

    let hour = FALLBACK_HOUR;
    let minute = FALLBACK_MINUTE;
    const hasExplicitTime = seg.hour !== null && seg.meridiem !== null;

    if (hasExplicitTime) {
      hour = Number(seg.hour) % 12;
      if (seg.meridiem!.toLowerCase() === "pm") hour += 12;
      minute = seg.minute ? Number(seg.minute) : 0;
    }

    const dayPadded = seg.day.padStart(2, "0");
    const monthPadded = String(month).padStart(2, "0");
    const hourPadded = String(hour).padStart(2, "0");
    const minutePadded = String(minute).padStart(2, "0");

    const naive = `${seg.year}-${monthPadded}-${dayPadded} ${hourPadded}:${minutePadded}:00`;
    const date = parseLondonDateTime(naive);
    if (date) results.push({ date, hasExplicitTime });
  }

  return results;
}