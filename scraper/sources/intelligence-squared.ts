/**
 * Intelligence Squared — everything upcoming is on one page (/attend), in a
 * grid of cards: "Sunday 4 October 2026, 7:30pm" · "Kings Place, London" ·
 * title · speakers. Their timezone labels are unreliable ("7:00pm BST" in
 * November), so the digits are read as London wall-clock time.
 *
 * Touring events ("UK TOUR, Multiple Venues") only list their dates on the
 * event page, as one row per city; only London rows are kept. Event pages
 * also give the description. They sit behind a stricter Cloudflare rule than
 * the listing, hence fetchHtml's browser fallback.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { loadHtml, type CheerioAPI } from "../core/html.ts";
import { clean, splitNames, speakersFromTitle, uniqNames } from "../core/text.ts";
import { parseDateTime, parseIsoAsLondonWallClock } from "../core/dates.ts";
import { enrichAll } from "../core/async.ts";
import { fetchHtml } from "../core/fetch.ts";

const SITE = "https://www.intelligencesquared.com";

function description($: CheerioAPI): string | null {
  const paras = $(".content-block-wc--copy p")
    .map((_, p) => clean($(p).text()))
    .get()
    .filter((t) => t.length > 30);
  return paras.slice(0, 3).join(" ") || null;
}

/**
 * London dates of a touring event, from its page's tour-date rows:
 * weekday/day/month boxes (no year), city, "Union Chapel, 7:00pm bst".
 */
function tourDates($: CheerioAPI): Array<{ start: { date: string; time: string | null }; venue: string }> {
  const out: Array<{ start: { date: string; time: string | null }; venue: string }> = [];
  $(".mutliple_dates_details, .multiple_dates_details").each((_, el) => {
    const row = $(el);
    if (!/london/i.test(clean(row.find(".town_city").first().text()))) return;
    const venueLine = clean(row.find(".venue_name").first().text());
    const start = parseDateTime(`${clean(row.find(".tour_event_date").text())} ${venueLine}`);
    if (!start) return;
    const venue = clean(venueLine.replace(/,?\s*\d{1,2}(?:[:.]\d{2})?\s*[ap]m.*$/i, ""));
    out.push({ start, venue: venue ? `${venue}, London` : "London" });
  });
  return out;
}

export const intelligenceSquared: Source = {
  id: "intelligence-squared",
  name: "Intelligence Squared",
  homepage: `${SITE}/attend`,
  defaults: { free: false, online: false },
  async scrape(ctx) {
    const $ = loadHtml(await ctx.http.text(`${SITE}/attend`));
    const fixed: RawEvent[] = [];
    const tours: Array<{ url: string; title: string; speakers: string[] }> = [];
    const seen = new Set<string>();

    $(".content-block--event.attend-block--event").each((_, el) => {
      const card = $(el);
      const url = card.find("a[href*='/events/']").first().attr("href");
      const title = clean(card.find(".event__title").first().text());
      if (!url || !title || seen.has(url)) return;
      seen.add(url);
      const speakers = uniqNames([...splitNames(clean(card.find(".event__speakers").first().text())), ...speakersFromTitle(title)]);
      const dateText = clean(card.find(".event__date").first().text());
      const start = parseDateTime(dateText);
      if (!start) {
        // "UK TOUR", "Multiple Dates": dates are on the event page. "Date TBC": skip.
        if (/tour|multiple/i.test(dateText)) tours.push({ url, title, speakers });
        return;
      }
      fixed.push({
        title,
        url,
        start,
        location: clean(card.find(".event__location").first().text()) || null,
        speakers,
        hints: [clean(card.find(".mobile_banners").text())],
      });
    });

    const inWindow = fixed.filter((e) => ctx.inWindow(e.start));
    const detailed = await enrichAll(
      ctx,
      inWindow,
      2,
      async (event) => {
        const page = loadHtml(await fetchHtml(ctx, event.url));
        const ics = page(".generate-ics[data-event-start-date]").first();
        const start = parseIsoAsLondonWallClock(ics.attr("data-event-start-date") ?? "") ?? event.start;
        const venue = page(".event-details--sidebar ul")
          .first()
          .find("li")
          .map((_, li) => clean(page(li).text()))
          .get()
          .filter(Boolean)
          .join(", ");
        return { ...event, start, location: venue || event.location, description: description(page) };
      },
      (e) => e.url,
    );

    // Touring events: one entry per London date.
    const touring: RawEvent[] = [];
    await enrichAll(
      ctx,
      tours,
      2,
      async (tour) => {
        const page = loadHtml(await fetchHtml(ctx, tour.url));
        const desc = description(page);
        for (const { start, venue } of tourDates(page)) {
          touring.push({ title: tour.title, url: tour.url, start, location: venue, description: desc, speakers: tour.speakers });
        }
        return tour;
      },
      (t) => t.url,
    );

    return [...detailed, ...touring];
  },
};
