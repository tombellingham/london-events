/**
 * Conway Hall — What's On cards carry a naive London start time, series +
 * title, blurb and a "Room | Virtual event" format line; the listing pages
 * with /page/N/. Prices ("Price: … Standard £10 …" or "Free") are on each
 * event page, fetched for events inside the window.
 *
 * Conway Hall hosts many external organisers (e.g. the Fortean Society); the
 * cross-source de-duplication merges those with the organiser's own listing.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseNaiveLondon } from "../core/dates.ts";
import { absUrl, loadHtml } from "../core/html.ts";
import { clean } from "../core/text.ts";
import { enrichAll } from "../core/async.ts";

const SITE = "https://www.conwayhall.org.uk";
const VENUE = "Conway Hall, 25 Red Lion Square, WC1R 4RL";

/** "Price: *A £2 venue levy…* In advance: • Supporter £15 • Standard £10 …" → "£10 (standard)". */
export function conwayPrice(text: string): string | null {
  const m = clean(text).match(/\bPrice:\s*(.{0,400})/i);
  if (!m) return null;
  const block = m[1].replace(/\*[^*]*levy[^*]*\*/gi, " ").replace(/\(\+\s*£\s?\d+(?:\.\d{2})?\s*venue levy\)/gi, " ");
  if (/^\s*free\b/i.test(block)) return "Free";
  const standard = block.match(/standard\s*£\s?(\d+(?:\.\d{2})?)/i);
  if (standard) return `£${standard[1]} (standard)`;
  const first = block.match(/£\s?(\d+(?:\.\d{2})?)/);
  if (first) return `£${first[1]}`;
  return /\bfree\b/i.test(block.slice(0, 80)) ? "Free" : null;
}

export const conwayHall: Source = {
  id: "conway-hall",
  name: "Conway Hall",
  homepage: `${SITE}/whats-on/`,
  defaults: { location: VENUE },
  // A talks listing: the Sunday classical concert series is left out.
  include: (e) => !/^sunday concerts?\b/i.test(e.title),
  async scrape(ctx) {
    const events: RawEvent[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= 10; page++) {
      const url = page === 1 ? `${SITE}/whats-on/` : `${SITE}/whats-on/page/${page}/`;
      const $ = loadHtml(await ctx.http.text(url, { allowStatus: [404] }));
      const cards = $("conwayhall-event");
      if (cards.length === 0) break;
      let beyond = 0;
      cards.each((_, el) => {
        const card = $(el);
        const link = absUrl(card.find('a[href*="/whats-on/event/"]').first().attr("href"), SITE);
        const start = parseNaiveLondon(card.find("time[datetime]").first().attr("datetime") ?? "");
        if (!link || !start || seen.has(`${link}|${start.date}`)) return;
        seen.add(`${link}|${start.date}`);
        if (ctx.isBeyondHorizon(start)) beyond++;
        const heading = card.find(".uk-modal-header h3, h3.event-title").first();
        const series = clean(heading.find("span").first().text()).replace(/:$/, "");
        const title = clean(heading.clone().find("span").remove().end().text()) || clean(heading.text());
        const body = card.find(".uk-modal-body").first();
        const format = clean(body.find("p.uk-text-small").last().text()); // "Brockway Room | Virtual event"
        const description = clean(body.find("p").not(".uk-text-small").map((_, p) => $(p).text()).get().join(" "));
        const [room, mode] = format.split("|").map(clean);
        events.push({
          title: series && !title.toLowerCase().includes(series.toLowerCase()) ? `${series}: ${title}` : title,
          url: link,
          start,
          location: /online|virtual/i.test(room ?? "") ? "Online" : room && !/^in[\s-]?person$/i.test(room) ? `${room}, ${VENUE}` : VENUE,
          online: /^(?:online|virtual)/i.test(room ?? "") ? true : mode && /virtual|online/i.test(mode) && room ? false : null,
          description: description || null,
          hints: [format],
        });
      });
      if (beyond === cards.length) break;
    }

    const inWindow = events.filter((e) => ctx.inWindow(e.start));
    return enrichAll(ctx, inWindow, 2, async (event) => {
      const $ = loadHtml(await ctx.http.text(event.url));
      const text = $(".uk-article, main, article").first().text() || $("body").text();
      return { ...event, priceText: conwayPrice(text) };
    }, (e) => e.url);
  },
};
