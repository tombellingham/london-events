/**
 * Adapter for London School of Economics (lse.ac.uk/events).
 *
 * Page is paginated but the first page alone covers well over four weeks
 * of upcoming events, so pagination is deliberately not implemented here.
 *
 * .card__description has two distinct shapes:
 *   "Wednesday 2 September 2026 6.45pm - 8pm"
 *     — single day, start and end time only — this is what we parse.
 *   "Monday 2 March 2026 9am to Wednesday 30 September 2026 - 7pm"
 *     — multi-week exhibitions/installations, identified by " to " in the
 *       text. These are filtered out entirely (see parseLseDateRange) —
 *       this adapter only surfaces single-occasion talks/lectures.
 */

import * as cheerio from "cheerio";
import type { Event } from "../types";
import { parseLondonDateTime } from "../dates";

const LISTING_URL =
  "https://www.lse.ac.uk/events/search-events?type=f22eb3fb-d907-51c4-9237-8ec021f2155e%2Cd9e2e4b3-4c51-4356-9008-63c59f56f534%2C9f357d51-c842-5eb3-8c2a-12d17fe42c07";
const SITE_ORIGIN = "https://www.lse.ac.uk";
const SOURCE_NAME = "London School of Economics";

// Auto-discovered by the aggregator's scrapers/ loader — must be exported
// by every adapter module.
export const name = SOURCE_NAME;

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

export async function scrape(): Promise<Event[]> {
  const res = await fetch(LISTING_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
  });

  if (!res.ok) {
    throw new Error(`LSE listing returned ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const events: Event[] = [];

  $(".listing-card").each((_, el) => {
    try {
      const card = $(el);

      const titleLink = card.find(".card__title a").first();
      const title = collapseWhitespace(titleLink.text());
      const href = titleLink.attr("href");
      if (!title || !href) return;

      const dateText = collapseWhitespace(
        card.find(".card__description").first().text()
      );
      const parsed = parseLseDateRange(dateText);
      if (!parsed) return;

      const speaker = collapseWhitespace(
        card.find(".card__speakers").first().text()
      );
      const location = collapseWhitespace(
        card.find(".card__location").first().text()
      );

      const descriptionParts = [
        speaker ? `Speaker: ${speaker}.` : "",
        location ? `Location: ${location}.` : "",
      ].filter(Boolean);
      const description = descriptionParts.join(" ") || "An LSE event.";

      events.push({
        title,
        description,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        url: new URL(href, SITE_ORIGIN).toString(),
        source: SOURCE_NAME,
      });
    } catch {
      // isolate per-card failures; keep going
    }
  });

  return events;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

interface LseParsedRange {
  startDate: Date;
  endDate: Date | undefined;
}

/**
 * Only handles the single-day form:
 *   "Wednesday 2 September 2026 6.45pm - 8pm"
 *
 * Multi-day/exhibition-style entries — "Monday 2 March 2026 9am to
 * Wednesday 30 September 2026 - 7pm" — are deliberately filtered out
 * rather than parsed: this aggregator is built around single-occasion
 * talks/lectures grouped by day, and a months-long exhibition doesn't fit
 * that model (its startDate is often already in the past by the time this
 * scrapes, which would either get it wrongly excluded by a "next 4 weeks"
 * filter or wrongly included as if it were happening "today").
 */
function parseLseDateRange(raw: string): LseParsedRange | null {
  if (raw.includes(" to ")) {
    return null; // multi-day exhibition-style event; not handled
  }

  const match = raw.match(
    /^[A-Za-z]+\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2})(?:\.(\d{2}))?\s*(am|pm)\s*-\s*(\d{1,2})(?:\.(\d{2}))?\s*(am|pm)$/i
  );
  if (!match) return null;

  const [
    ,
    dayStr,
    monthName,
    yearStr,
    startHourStr,
    startMinuteStr,
    startMeridiem,
    endHourStr,
    endMinuteStr,
    endMeridiem,
  ] = match;

  const month = MONTHS[monthName.toLowerCase()];
  if (!month) return null;

  const day = dayStr.padStart(2, "0");
  const monthPadded = String(month).padStart(2, "0");

  const startDate = buildDate(
    yearStr,
    monthPadded,
    day,
    startHourStr,
    startMinuteStr,
    startMeridiem
  );
  if (!startDate) return null;

  const endDate =
    buildDate(yearStr, monthPadded, day, endHourStr, endMinuteStr, endMeridiem) ??
    undefined;

  return { startDate, endDate };
}

function buildDate(
  year: string,
  monthPadded: string,
  dayPadded: string,
  hourStr: string,
  minuteStr: string | undefined,
  meridiem: string
): Date | null {
  let hour = Number(hourStr) % 12;
  if (meridiem.toLowerCase() === "pm") hour += 12;
  const minute = minuteStr ? Number(minuteStr) : 0;

  const hourPadded = String(hour).padStart(2, "0");
  const minutePadded = String(minute).padStart(2, "0");

  const naive = `${year}-${monthPadded}-${dayPadded} ${hourPadded}:${minutePadded}:00`;
  return parseLondonDateTime(naive);
}