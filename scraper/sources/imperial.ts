/**
 * Imperial College London — the What's On page loads its cards from an HTML
 * fragment service (/EventsView/page/) that takes start/quantity paging.
 * Cards carry proper ISO start times, venue and type tags. We read the
 * college's "institutional" events feed (the default What's On view) and keep
 * talk-like types, skipping socials, workshops, open days and the like.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseIsoInstant } from "../core/dates.ts";
import { absUrl, loadHtml } from "../core/html.ts";
import { clean, speakersFromPhrase, trailingSpeaker } from "../core/text.ts";

const SITE = "https://www.imperial.ac.uk";
const PAGE = 100;
const KEEP_TYPES = /^(?:lecture|seminar|symposium|debate|conference|festival|film screening|imperial lates|colloquium|talk|panel)/i;

export const imperial: Source = {
  id: "imperial",
  name: "Imperial College London",
  homepage: `${SITE}/whats-on/`,
  defaults: { free: true, location: "Imperial College London" },
  async scrape(ctx) {
    const events: RawEvent[] = [];
    const seen = new Set<string>();
    for (let start = 0; start < 2000; start += PAGE) {
      const params = new URLSearchParams({
        start: String(start),
        quantity: String(PAGE),
        more: "true",
        horizontal: "false",
        images: "false",
        audience: "",
        tags: "institutional-event",
        match: "any",
        show: "future",
      });
      const $ = loadHtml(await ctx.http.text(`${SITE}/EventsView/page/?${params}`));
      const cards = $('a[href^="/events/"]');
      if (cards.length === 0) break;
      let beyond = 0;
      cards.each((_, el) => {
        const card = $(el);
        const url = absUrl(card.attr("href"), SITE);
        const iso = card.find("time[datetime]").first().attr("datetime");
        const when = iso ? parseIsoInstant(iso) : null;
        if (!url || !when || seen.has(url)) return;
        seen.add(url);
        if (ctx.isBeyondHorizon(when)) beyond++;
        const tags = card.find(".tags li span").map((_, s) => clean($(s).text())).get().filter((t) => t !== "Event");
        if (!tags.some((t) => KEEP_TYPES.test(t))) return;
        const title = clean(card.find(".title").first().text());
        const blurb = clean(card.attr("title"));
        const venue = clean(card.find(".venue").first().text());
        events.push({
          title,
          url,
          start: when,
          location: /^online only$/i.test(venue) ? "Online" : venue || null,
          description: blurb && blurb !== title ? blurb : null,
          speakers: [...trailingSpeaker(title), ...speakersFromPhrase(title)],
          hints: tags,
          tags,
        });
      });
      if (beyond > 0 && beyond === cards.length) break;
      if (cards.length < PAGE / 2) break;
    }
    return events;
  },
};
