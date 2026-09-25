/**
 * 5x15 — the events page lists all upcoming evenings (each rendered twice,
 * desktop + mobile) with start time, title, blurb, venue label and the
 * "Featuring talks by" speaker links. The <time datetime> values carry a
 * bogus +00:00 offset on London wall-clock digits, so we read the digits as
 * London time. Tickets are sold through Eventbrite; every evening is paid.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseIsoAsLondonWallClock } from "../core/dates.ts";
import { absUrl, loadHtml } from "../core/html.ts";
import { clean, uniqNames } from "../core/text.ts";

const SITE = "https://www.5x15.com";

export const fiveByFifteen: Source = {
  id: "5x15",
  name: "5x15",
  homepage: `${SITE}/events`,
  defaults: { free: false, online: false },
  async scrape(ctx) {
    const $ = loadHtml(await ctx.http.text(`${SITE}/events`));
    const events = new Map<string, RawEvent>();
    $("a[href*='/events/']:has(h2)").each((_, el) => {
      const link = $(el);
      const url = absUrl(link.attr("href"), SITE);
      if (!url || events.has(url)) return;
      // Walk up to the card: the nearest ancestor holding the <time> and, when present, the speaker list.
      const ancestors = link.parents();
      const withTime = ancestors.filter((_, p) => $(p).find("time[datetime]").length > 0);
      const withSpeakers = withTime.filter((_, p) => $(p).find("a[href*='/speakers/']").length > 0 && $(p).find("a[href*='/events/']:has(h2)").length <= 2);
      const card = withSpeakers.length ? withSpeakers.first() : withTime.first();
      const start = parseIsoAsLondonWallClock(card.find("time[datetime]").first().attr("datetime") ?? "");
      if (!start) return;
      const venue = card
        .find(".c-label")
        .map((_, l) => clean($(l).text()))
        .get()
        .find((t) => t && !/featuring|talks? by/i.test(t));
      events.set(url, {
        title: clean(link.find("h2").first().text()),
        url,
        start,
        location: venue ?? null,
        description: clean(link.find("p").first().text()) || null,
        speakers: uniqNames(card.find("a[href*='/speakers/']").map((_, a) => clean($(a).text())).get()),
      });
    });
    if (events.size === 0) throw new Error("No event cards found — page structure may have changed");
    return [...events.values()];
  },
};
