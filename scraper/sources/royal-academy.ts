/**
 * Royal Academy of Arts — "Talks & lectures" filter of the What's on
 * listing (a Next.js page, server-rendered): cards give title, subtitle and
 * date ("9 October 2026", no time), paginated with &page=N and a
 * "1 - 12 of 20 results found" counter. Each event page's hero has the
 * weekday + time range, the venue ("Benjamin West Lecture Theatre |
 * Burlington Gardens") and prices ("£15 / £9", or "Free").
 *
 * The site is behind Cloudflare; from CI it only answers a real browser.
 */

import type { LondonDateTime, RawEvent, Source } from "../core/types.ts";
import { absUrl, loadHtml } from "../core/html.ts";
import { clean, speakersFromTitle } from "../core/text.ts";
import { parseDate, parseDateTime } from "../core/dates.ts";
import { enrichAll } from "../core/async.ts";
import { fetchHtml, laterPage, preferBrowser } from "../core/fetch.ts";

/** Listing entries always carry a London date (time filled in from the event page). */
type Listed = RawEvent & { start: LondonDateTime };

// Plain requests from CI always meet a bot wall here.
preferBrowser("www.royalacademy.org.uk");

const SITE = "https://www.royalacademy.org.uk";
const LISTING = `${SITE}/exhibitions-and-events?what-filter=talks-lectures`;

export const royalAcademy: Source = {
  id: "royal-academy",
  name: "Royal Academy of Arts",
  homepage: LISTING,
  defaults: { location: "Royal Academy of Arts, Burlington House, Piccadilly, W1J 0BD" },
  // Open days are filed under talks too.
  include: (e) => !/\bopen (?:day|evening)\b/i.test(e.title),
  async scrape(ctx) {
    const listed: Listed[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= 10; page++) {
      // No waitFor: the filter is re-applied client-side, so let the page settle.
      const html = await laterPage(ctx, page, 1, () => fetchHtml(ctx, page > 1 ? `${LISTING}&page=${page}` : LISTING));
      if (html === null) break;
      const $ = loadHtml(html);
      let added = 0;
      $(".event-card").each((_, el) => {
        const card = $(el);
        const link = card.find("a.event-card__link").first();
        const url = absUrl(link.attr("href"), `${SITE}/`);
        // The page also carries promo cards (exhibitions, "Plan your visit"): events only.
        if (!url || !/\/event\//.test(url) || seen.has(url)) return;
        // Belt and braces: keep talk-type cards only (courses and workshops share the listing template).
        const label = clean(card.find(".event-card__label").text());
        if (label && !/talk|lecture|discussion|conversation|debate|symposium|reading|free/i.test(label)) return;
        const date = parseDate(clean(card.find(".event-card__date").first().text()));
        if (!date) return;
        seen.add(url);
        added++;
        const title = clean(link.text());
        listed.push({
          title,
          url,
          start: { date, time: null },
          free: /\bfree\b/i.test(clean(card.find(".event-card__label").text())) ? true : undefined,
          speakers: speakersFromTitle(title),
          hints: [clean(card.find(".event-card__subtitle").text())],
        });
      });
      const counter = clean($("main").text()).match(/(\d+)\s*-\s*(\d+)\s+of\s+(\d+)\s+results/i);
      if (!added || !counter || Number(counter[2]) >= Number(counter[3])) break;
    }

    const inWindow = listed.filter((e) => ctx.inWindow(e.start));
    return enrichAll(
      ctx,
      inWindow,
      2,
      async (event) => {
        const $ = loadHtml(await fetchHtml(ctx, event.url, { browser: { waitFor: ".exhibition-hero__promo" } }));
        const when = parseDateTime(clean($(".exhibition-hero__promo__date").first().text()));
        const venue = clean($(".exhibition-hero__promo__location").first().text()).replace(/\s*\|\s*/g, ", ");
        const price = clean($(".exhibition-hero__tickets__price").first().text());
        const paras = $("main p")
          .filter((_, p) => {
            const el = $(p);
            if (el.closest(".event-card, .exhibition-hero__tickets, .exhibition-hero__friends").length) return false;
            // The hero's label/venue lines are <p>s too; its intro text is the only one we want.
            return !el.parent().is(".exhibition-hero__promo") || el.is(".exhibition-hero__promo__text");
          })
          .map((_, p) => clean($(p).text()))
          .get()
          .filter((t) => t.length > 60 && !/^click here/i.test(t));
        const description = paras.join(" ");
        return {
          ...event,
          start: when && when.date === event.start.date ? when : event.start,
          location: venue ? (/online/i.test(venue) ? venue : `${venue}, Royal Academy of Arts`) : null,
          priceText: price || null,
          description: description || null,
          speakers: speakersFromTitle(event.title, description),
        };
      },
      (e) => e.url,
    );
  },
};
