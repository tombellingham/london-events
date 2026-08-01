/**
 * Adapter for Pints of Knowledge, hosted on Ticket Tailor
 * (tickettailor.com/events/pintsofknowledge).
 *
 * Ticket Tailor blocks plain HTTP fetches — even with a realistic browser
 * header set, requests came back 403. That points to bot-protection
 * middleware doing more than User-Agent checks (TLS fingerprinting, JS
 * challenges, `navigator.webdriver` detection, etc.), which only an actual
 * browser engine can get past. So this adapter uses Playwright to render
 * the page in a real (headless) Chromium instance, then hands the
 * resulting HTML to the same cheerio-based parsing every other adapter
 * uses.
 *
 * No description field exists anywhere on the card — just title, a date
 * range with explicit start AND end times (the only adapter so far that
 * gives us a real endDate rather than us guessing/omitting one), and a
 * venue. Description is synthesized from the venue since there's nothing
 * else to draw on.
 *
 * Requires `playwright` as a dependency, plus its browser binary:
 *   npm install --save-dev playwright
 *   npx playwright install --with-deps chromium
 * In CI (GitHub Actions), the browser-install step needs to run before
 * this adapter — it won't work with just `npm ci`.
 */

import { chromium } from "playwright";
import * as cheerio from "cheerio";
import type { Event } from "../types";
import { parseLondonDateTime } from "../dates";

const LISTING_URL = "https://www.tickettailor.com/events/pintsofknowledge";
const SITE_ORIGIN = "https://www.tickettailor.com";
const SOURCE_NAME = "Pints of Knowledge";

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
  const html = await fetchRenderedHtml();
  return parseListingHtml(html);
}

/**
 * Launches a real Chromium instance, navigates to the listing, and waits
 * for at least one event card to appear before grabbing the fully-rendered
 * HTML. If the listing genuinely has zero upcoming events some day, this
 * wait will time out — that's treated as "no cards found" rather than an
 * error, since we can't distinguish it from a still-blocked request without
 * manually checking.
 */
async function fetchRenderedHtml(): Promise<string> {
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      locale: "en-GB",
      timezoneId: "Europe/London",
      viewport: { width: 1280, height: 800 },
    });

    // Basic headless-detection evasion: Playwright/Puppeteer set
    // navigator.webdriver = true by default, which is one of the simplest
    // signals bot-protection checks for. This doesn't defeat sophisticated
    // fingerprinting (e.g. TLS-level detection), but it's a reasonable
    // first line of defense before reaching for something heavier like
    // playwright-extra's stealth plugin.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const page = await context.newPage();
    await page.goto(LISTING_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    await page
      .waitForSelector(".events-listing__item", { timeout: 15_000 })
      .catch(() => {
        // No cards appeared in time — could mean genuinely zero events,
        // or the block wasn't actually bypassed. parseListingHtml()
        // returning [] either way; check console output / a manual run
        // with headless: false if that's suspicious.
      });

    return await page.content();
  } finally {
    await browser.close();
  }
}

function parseListingHtml(html: string): Event[] {
  const $ = cheerio.load(html);
  const events: Event[] = [];

  $(".events-listing__item").each((_, el) => {
    try {
      const card = $(el);

      const title = stripSurroundingQuotes(
        collapseWhitespace(card.find(".event__title a").first().text())
      );
      const href = card.find(".event__title a").first().attr("href");
      if (!title || !href) return;

      const dateText = collapseWhitespace(
        card.find(".event-meta__date").first().text()
      );
      const parsed = parseTicketTailorDateRange(dateText);
      if (!parsed) return;

      const location = collapseWhitespace(
        card.find(".event-meta__location").first().text()
      );

      events.push({
        title,
        description: location
          ? `A Pints of Knowledge event at ${location}.`
          : "A Pints of Knowledge event.",
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
 * Titles are entered with literal leading/trailing quote marks by whoever
 * runs Pints of Knowledge (e.g. `"The Changing Landscape of Pornography..."`)
 * — strips a single matching pair of straight or curly quotes from the
 * ends, if present. Leaves quotes elsewhere in the title (e.g. within a
 * subtitle) untouched.
 */
function stripSurroundingQuotes(text: string): string {
  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["\u201C", "\u201D"], // “ ”
    ["'", "'"],
    ["\u2018", "\u2019"], // ‘ ’
  ];

  for (const [open, close] of quotePairs) {
    if (text.startsWith(open) && text.endsWith(close) && text.length > 1) {
      return text.slice(open.length, text.length - close.length).trim();
    }
  }

  return text;
}

/**
 * Parses the collapsed text of .event-meta__date, e.g.:
 *   "Mon 3 Aug 2026 7:00 PM - 8:30 PM"
 * (the weekday name is present but unused — redundant with the parsed date).
 */
function parseTicketTailorDateRange(
  raw: string
): { startDate: Date; endDate: Date | undefined } | null {
  const match = raw.match(
    /^[A-Za-z]+\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM))?$/i
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

  let endDate: Date | undefined;
  if (endHourStr && endMinuteStr && endMeridiem) {
    endDate =
      buildDate(yearStr, monthPadded, day, endHourStr, endMinuteStr, endMeridiem) ??
      undefined;
  }

  return { startDate, endDate };
}

function buildDate(
  year: string,
  monthPadded: string,
  dayPadded: string,
  hourStr: string,
  minuteStr: string,
  meridiem: string
): Date | null {
  let hour = Number(hourStr) % 12;
  if (meridiem.toUpperCase() === "PM") hour += 12;
  const minute = Number(minuteStr);

  const hourPadded = String(hour).padStart(2, "0");
  const minutePadded = String(minute).padStart(2, "0");

  const naive = `${year}-${monthPadded}-${dayPadded} ${hourPadded}:${minutePadded}:00`;
  return parseLondonDateTime(naive);
}