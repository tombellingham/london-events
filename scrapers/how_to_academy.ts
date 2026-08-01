/**
 * Adapter for How To Academy (howtoacademy.com), London events only.
 *
 * The listing page has two separate sections — "SINGLE EVENTS" and
 * "MULTIPLE DATES" — sharing identical class names throughout, so class
 * selectors alone can't distinguish them. We only want single-date events
 * (a multi-date adapter/handling would be a separate concern), so we find
 * the <h2 class="event-type-header"> whose text is literally "SINGLE
 * EVENTS" and scope all card selection to its sibling container, ignoring
 * "MULTIPLE DATES" entirely.
 *
 * Each card's `data-date` attribute is a genuine Unix timestamp at UTC
 * midnight of the event's calendar date (verified: data-date="1788220800"
 * decodes to exactly 2026-09-01T00:00:00Z, matching the visible "Sept 1"
 * label) — this is the only place the year appears at all, since the
 * visible date text only shows month + day. We use it for year/month/day
 * and parse the specific time-of-day separately from the human-readable
 * text, then combine the two.
 */

import * as cheerio from "cheerio";
import type { Event } from "../types";
import { parseLondonDateTime } from "../dates";

const LISTING_URL = "https://howtoacademy.com/events-calendar/?event_type=london";
const SOURCE_NAME = "How To Academy";

// Auto-discovered by the aggregator's scrapers/ loader — must be exported
// by every adapter module.
export const name = SOURCE_NAME;

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
      `How To Academy listing returned ${res.status} ${res.statusText}`
    );
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const events: Event[] = [];

  const singleEventsHeader = $("h2.event-type-header")
    .filter((_, h2) => collapseWhitespace($(h2).text()).toUpperCase() === "SINGLE EVENTS")
    .first();

  if (singleEventsHeader.length === 0) {
    throw new Error(
      'How To Academy: could not find the "SINGLE EVENTS" section header — page structure may have changed'
    );
  }

  const singleEventsContainer = singleEventsHeader.next(".calendar_page__months");
  if (singleEventsContainer.length === 0) {
    throw new Error(
      'How To Academy: found "SINGLE EVENTS" header but no adjacent .calendar_page__months container'
    );
  }

  singleEventsContainer
    .find("a.calendar_page__months--single")
    .each((_, el) => {
      try {
        const card = $(el);

        const url = card.attr("href");
        const title = collapseWhitespace(
          card.find(".event_info h2").eq(0).text()
        );
        if (!url || !title) return;

        const dataDateSeconds = Number(card.attr("data-date"));
        if (!dataDateSeconds || Number.isNaN(dataDateSeconds)) return;

        // data-date is UTC midnight of the correct calendar date — reading
        // its UTC components back out gives the right year/month/day
        // regardless of what timezone this script runs in.
        const dateOnly = new Date(dataDateSeconds * 1000);
        const year = dateOnly.getUTCFullYear();
        const month = dateOnly.getUTCMonth() + 1;
        const day = dateOnly.getUTCDate();

        const detailsText = collapseWhitespace(
          card.find("h2.margin-top:not(.mobile) span.styled").first().text()
        );
        const parsedTime = parseTimeAndVenue(detailsText);
        if (!parsedTime) return;

        const naive = `${year}-${String(month).padStart(2, "0")}-${String(
          day
        ).padStart(2, "0")} ${String(parsedTime.hour).padStart(2, "0")}:${String(
          parsedTime.minute
        ).padStart(2, "0")}:00`;
        const startDate = parseLondonDateTime(naive);
        if (!startDate) return;

        const subtitle = collapseWhitespace(
          card.find(".event_info h2").eq(1).text()
        );

        const descriptionParts = [subtitle, parsedTime.venue ? `At ${parsedTime.venue}.` : ""].filter(
          Boolean
        );
        const description =
          descriptionParts.join(" ") || "A How To Academy event.";

        events.push({
          title,
          description,
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

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Parses the collapsed "styled" text, e.g.:
 *   "Tuesday, 6:30 pm BST The Conduit, London"
 * Weekday and the BST/GMT abbreviation are both redundant with what
 * parseLondonDateTime already derives from the date itself, so they're
 * matched but discarded — only hour/minute/meridiem and the trailing venue
 * name are used.
 */
function parseTimeAndVenue(
  text: string
): { hour: number; minute: number; venue: string } | null {
  const match = text.match(
    /^[A-Za-z]+,\s*(\d{1,2}):(\d{2})\s*(am|pm)\s*(?:BST|GMT)\s*(.*)$/i
  );
  if (!match) return null;

  const [, hourStr, minuteStr, meridiem, venue] = match;

  let hour = Number(hourStr) % 12;
  if (meridiem.toLowerCase() === "pm") hour += 12;
  const minute = Number(minuteStr);

  return { hour, minute, venue: venue.trim() };
}