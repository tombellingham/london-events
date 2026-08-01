/**
 * Adapter for Seed Talks (seedtalks.co.uk).
 *
 * Unlike Gresham (JSON feed) or Conway Hall (JSON-LD per card), this page
 * exposes no machine-readable date at all — just human text split across
 * two places: a <time> element ("Tuesday, 4 August 2026") and a separate
 * span next to a clock emoji ("7pm"). We parse both and combine them.
 *
 * Also unconfirmed: whether this Next.js page is server-rendered (in which
 * case a plain fetch() sees the real card markup, as below) or hydrated
 * client-side from an API call (in which case fetch() would see an empty
 * shell and this adapter would silently return zero events). If a local
 * test run comes back empty, that's the signal to switch to a headless
 * browser (e.g. Playwright) rather than debug the selectors further.
 */

import * as cheerio from "cheerio";
import type { Event } from "../types";
import { parseLondonDateTime } from "../dates";

const LISTING_URL = "https://www.seedtalks.co.uk/in/london";
const SOURCE_NAME = "Seed Talks";

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
    headers: { "User-Agent": "Mozilla/5.0 (compatible; EventAggregator/1.0)" },
  });

  if (!res.ok) {
    throw new Error(
      `Seed Talks listing returned ${res.status} ${res.statusText}`
    );
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const events: Event[] = [];

  $("article").each((_, el) => {
    try {
      const card = $(el);

      const titleLink = card.find("h3 a").first();
      const title = titleLink.text().trim();
      const url = titleLink.attr("href");
      if (!title || !url) return;

      const dateText = card.find("time").first().text().trim();
      const timeText = findIconLabelText($, card, "🕐");
      const location = findIconLabelText($, card, "📍");

      const startDate = parseSeedTalksDateTime(dateText, timeText);
      if (!startDate) return;

      const blurb = card.find("p").first().text().trim();
      const description = location ? `${blurb} Location: ${location}.` : blurb;

      events.push({
        title,
        description: description || "A Seed Talks event.",
        startDate,
        url,
        source: SOURCE_NAME,
      });
    } catch {
      // isolate per-card failures; keep going
    }
  });

  return events;
}

/**
 * The time-of-day and location are each rendered as:
 *   <span class="flex items-center gap-2">
 *     <span>🕐</span><span>7pm</span>
 *   </span>
 * with no distinguishing class — the emoji is the only reliable marker.
 * We scan each icon+label pair and return the label text that follows the
 * given emoji.
 */
function findIconLabelText(
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<any>,
  icon: string
): string | null {
  let result: string | null = null;

  card.find("span.flex.items-center.gap-2").each((_, groupEl) => {
    if (result) return;

    const children = $(groupEl).children("span");
    const iconText = children.eq(0).text().trim();
    if (iconText === icon) {
      result = children.eq(1).text().trim() || null;
    }
  });

  return result;
}

function parseSeedTalksDateTime(
  dateText: string,
  timeText: string | null
): Date | null {
  const dateMatch = dateText.match(
    /^[A-Za-z]+,\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/
  );
  if (!dateMatch) return null;

  const [, dayStr, monthName, yearStr] = dateMatch;
  const month = MONTHS[monthName.toLowerCase()];
  if (!month) return null;

  let hour = 19; // fallback if time text is missing/unparseable — most Seed Talks events are evening
  let minute = 0;

  if (timeText) {
    const timeMatch = timeText
      .trim()
      .match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (timeMatch) {
      const [, hourStr, minuteStr, meridiem] = timeMatch;
      hour = Number(hourStr) % 12;
      if (meridiem.toLowerCase() === "pm") hour += 12;
      minute = minuteStr ? Number(minuteStr) : 0;
    }
  }

  const day = dayStr.padStart(2, "0");
  const monthPadded = String(month).padStart(2, "0");
  const hourPadded = String(hour).padStart(2, "0");
  const minutePadded = String(minute).padStart(2, "0");

  const naive = `${yearStr}-${monthPadded}-${day} ${hourPadded}:${minutePadded}:00`;
  return parseLondonDateTime(naive);
}