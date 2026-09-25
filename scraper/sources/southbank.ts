/**
 * Southbank Centre — Talks & debates listing, paginated as
 * /whats-on/page/N/?artform-filter=talks-debates. Cards carry everything we
 * need: title, "Sat 3 Oct 2026, 7.45pm" date text (sometimes several dates
 * joined by "&"), venue ("Purcell Room", "Online Events") and a "Free" price
 * label on free events — so no per-event requests.
 *
 * Southbank's Cloudflare setup is quick to challenge bursts of requests, so
 * the host is throttled hard and challenged pages are retried in a browser.
 */

import type { LondonDateTime, RawEvent, Source } from "../core/types.ts";
import { configureHost } from "../core/http.ts";
import { fetchHtml, laterPage } from "../core/fetch.ts";
import { loadHtml } from "../core/html.ts";
import { clean, speakersFromTitle } from "../core/text.ts";
import { formatDate, inferYear, isValidDate, monthNumber, parseTime } from "../core/dates.ts";

const SITE = "https://www.southbankcentre.co.uk";
const LISTING = (page: number) => `${SITE}/whats-on/${page > 1 ? `page/${page}/` : ""}?artform-filter=talks-debates`;

configureHost("www.southbankcentre.co.uk", { concurrency: 1, intervalMs: 2500 });

/**
 * "Sat 22 Aug 2026, 7.45pm" · "Fri 4 Sep & Sat 5 Sep 2026" · "Fri 4 Sep & Sat 5 Sep 2026, 7.45pm"
 * → one entry per date; year and time borrowed from the last segment that has them.
 */
export function parseSouthbankDates(text: string, now = new Date()): LondonDateTime[] {
  const [datesPart, ...rest] = clean(text).split(",");
  const time = parseTime(rest.join(","));
  const segments = datesPart.split(/\s*&\s*/);
  const parsed = segments.map((seg) => seg.match(/(\d{1,2})\s+([A-Za-z]+)\.?(?:\s+(\d{4}))?/));
  let year: number | null = null;
  const out: LondonDateTime[] = [];
  for (let i = parsed.length - 1; i >= 0; i--) {
    const m = parsed[i];
    if (!m) continue;
    const month = monthNumber(m[2]);
    if (!month) continue;
    year = m[3] ? Number(m[3]) : (year ?? inferYear(month, Number(m[1]), now));
    if (!isValidDate(year, month, Number(m[1]))) continue;
    out.unshift({ date: formatDate(year, month, Number(m[1])), time });
  }
  return out;
}


export const southbank: Source = {
  id: "southbank",
  name: "Southbank Centre",
  homepage: `${SITE}/whats-on/?artform-filter=talks-debates`,
  defaults: { free: false, location: "Southbank Centre, Belvedere Road, SE1 8XX" },
  async scrape(ctx) {
    const events: RawEvent[] = [];
    for (let page = 1; page <= 12; page++) {
      const html = await laterPage(ctx, page, 1, () =>
        fetchHtml(ctx, LISTING(page), { http: { allowStatus: [404] }, browser: { waitFor: ".c-event-card" } }),
      );
      if (html === null) break;
      const $ = loadHtml(html);
      const cards = $(".c-event-card");
      if (cards.length === 0) break;
      let beyond = 0;
      cards.each((_, el) => {
        const card = $(el);
        const title = clean(card.find(".c-event-card__title").first().text());
        const url = card.find(".c-event-card__cover-link").first().attr("href");
        const dates = parseSouthbankDates(card.find(".c-event-card__daterange").first().text());
        if (!title || !url || dates.length === 0) return;
        if (dates.every((d) => ctx.isBeyondHorizon(d))) beyond++;
        const venue = clean(card.find(".c-event-card__location").first().text());
        const priceLabel = clean(card.find(".c-event-card__price-label").text()).replace(/^tickets\s*/i, "");
        const online = /^online/i.test(venue) || /live\s*stream/i.test(title);
        const blurb = clean(card.find(".c-event-card__listing-details").first().text());
        for (const start of dates) {
          events.push({
            title,
            url,
            start,
            location: online ? "Online" : venue ? `${venue}, Southbank Centre` : null,
            online: online ? true : venue ? false : null,
            description: blurb || null,
            priceText: priceLabel || null,
            speakers: speakersFromTitle(title, blurb),
            hints: [clean(card.find(".c-event-card__primary-artform").text())],
          });
        }
      });
      if (beyond === cards.length) break;
      if (!$(`a.next.page-numbers, a[href*="/page/${page + 1}/"]`).length) break;
    }
    return events;
  },
};
