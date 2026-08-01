/**
 * Adapter for King's College London (kcl.ac.uk/events).
 *
 * Cleanest markup of any adapter so far: a proper <time datetime="..."> with
 * both start and end in one string, e.g.
 *   "12 August 2026 12:00 to 13:00"
 * No JSON feed or JSON-LD, but no ambiguity either — full month names, an
 * explicit year, and both ends of the time range given directly.
 */

import * as cheerio from "cheerio";
import type { Event } from "../types";
import { parseLondonDateTime } from "../dates";

const LISTING_URL =
  "https://www.kcl.ac.uk/events/events-calendar?type=cb7cba1a-7738-43c6-a9f0-5856b5c0f03d";
const SITE_ORIGIN = "https://www.kcl.ac.uk";
const SOURCE_NAME = "King's College London";

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
    throw new Error(
      `King's College London listing returned ${res.status} ${res.statusText}`
    );
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const events: Event[] = [];

  $(".event-list-item").each((_, el) => {
    try {
      const card = $(el);

      const titleLink = card.find(".card__heading a").first();
      const title = collapseWhitespace(titleLink.text());
      const href = titleLink.attr("href");
      if (!title || !href) return;

      const dateText = card.find(".card__date").first().attr("datetime")
        ?? card.find(".card__date").first().text();
      const parsed = parseKclDateRange(collapseWhitespace(dateText ?? ""));
      if (!parsed) return;

      const description = collapseWhitespace(
        card.find(".card__text").first().text()
      );

      events.push({
        title,
        description: description || "A King's College London event.",
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

/**
 * Parses strings like "12 August 2026 12:00 to 13:00".
 */
function parseKclDateRange(
  raw: string
): { startDate: Date; endDate: Date | undefined } | null {
  const match = raw.match(
    /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})\s+to\s+(\d{1,2}):(\d{2})$/i
  );
  if (!match) return null;

  const [, dayStr, monthName, yearStr, startHour, startMinute, endHour, endMinute] =
    match;

  const month = MONTHS[monthName.toLowerCase()];
  if (!month) return null;

  const day = dayStr.padStart(2, "0");
  const monthPadded = String(month).padStart(2, "0");

  const startDate = parseLondonDateTime(
    `${yearStr}-${monthPadded}-${day} ${startHour.padStart(2, "0")}:${startMinute}:00`
  );
  if (!startDate) return null;

  const endDate =
    parseLondonDateTime(
      `${yearStr}-${monthPadded}-${day} ${endHour.padStart(2, "0")}:${endMinute}:00`
    ) ?? undefined;

  return { startDate, endDate };
}