/**
 * Barbican — "Talks & events" listing (Drupal, ?page=N from 0). Each card
 * has true-UTC <time datetime> values (one per performance), the title and an
 * intro; the venue ("Barbican Hall", "Frobisher Auditorium 1"…) and presenter
 * come from the event page. Prices load client-side from the box office, so
 * events default to paid unless the text says otherwise.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseIsoInstant } from "../core/dates.ts";
import { absUrl, loadHtml } from "../core/html.ts";
import { clean, speakersFromTitle } from "../core/text.ts";
import { enrichAll } from "../core/async.ts";

const SITE = "https://www.barbican.org.uk";

export const barbican: Source = {
  id: "barbican",
  name: "Barbican",
  homepage: `${SITE}/whats-on/talks-events`,
  defaults: { free: false, location: "Barbican Centre, Silk Street, EC2Y 8DS", online: false },
  async scrape(ctx) {
    const events: RawEvent[] = [];
    for (let page = 0; page < 15; page++) {
      const $ = loadHtml(await ctx.http.text(`${SITE}/whats-on/talks-events${page ? `?page=${page}` : ""}`));
      const cards = $("article.listing--event");
      if (cards.length === 0) break;
      let beyond = 0;
      cards.each((_, el) => {
        const card = $(el);
        const url = absUrl(card.find("a.search-listing__link").first().attr("href"), SITE);
        const title = clean(card.find(".listing-title").first().text());
        const times = card.find("time[datetime]").map((_, t) => $(t).attr("datetime")).get().map((d) => parseIsoInstant(d ?? "")).filter((d): d is Date => d !== null);
        if (!url || !title || times.length === 0) return;
        if (times.every((t) => ctx.isBeyondHorizon(t))) beyond++;
        const intro = clean(card.find(".search-listing__intro > div").not(":has(time)").text()) || clean(card.find(".search-listing__intro p").not(".listing-date").text());
        const tags = card.find(".tags .tag__plain").map((_, t) => clean($(t).text())).get();
        for (const start of times) {
          events.push({ title, url, start, description: intro || null, speakers: speakersFromTitle(title, intro), hints: tags, tags });
        }
      });
      if (beyond === cards.length || !$(`a[href*="page=${page + 1}"]`).length) break;
    }

    const inWindow = events.filter((e) => ctx.inWindow(e.start));
    const venues = new Map<string, { venue: string; presenter: string }>();
    await enrichAll(ctx, [...new Set(inWindow.map((e) => e.url))], 3, async (url) => {
      const $ = loadHtml(await ctx.http.text(url));
      venues.set(url, { venue: clean($(".event-byline__venue").first().text()), presenter: clean($(".heading-group__secondary").first().text()) });
      return url;
    }, (u) => u);
    return inWindow.map((e) => {
      const info = venues.get(e.url);
      if (!info) return e;
      return {
        ...e,
        location: info.venue ? (/barbican/i.test(info.venue) ? info.venue : `${info.venue}, Barbican Centre`) : null,
        hints: [...(e.hints ?? []), info.presenter],
      };
    });
  },
};
