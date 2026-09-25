/**
 * Royal Society for Asian Affairs — upcoming lectures are posts in the
 * "upcoming-events" category shown on /rsaa-events/. Each excerpt reads like
 * "An online lecture with Professor X, moderated by Y. 15 October 2026
 * 14:00 BST", which gives format, speakers, date and time; the post body
 * supplies the description.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseDateTime } from "../core/dates.ts";
import { absUrl, loadHtml } from "../core/html.ts";
import { clean, speakersFromPhrase } from "../core/text.ts";
import { enrichAll } from "../core/async.ts";

const SITE = "https://rsaa.org.uk";

export const rsaa: Source = {
  id: "rsaa",
  name: "Royal Society for Asian Affairs",
  homepage: `${SITE}/rsaa-events/`,
  defaults: { free: true },
  async scrape(ctx) {
    const $ = loadHtml(await ctx.http.text(`${SITE}/rsaa-events/`));
    const events: RawEvent[] = [];
    $("article").each((_, el) => {
      const post = $(el);
      const link = post.find(".entry-title a").first();
      const url = absUrl(link.attr("href"), SITE);
      if (!url || !/\/upcoming-events\//.test(url)) return;
      const excerpt = clean(post.find(".entry-content").text());
      const when = parseDateTime(excerpt);
      if (!when) return;
      const lead = excerpt.split(/\b\d{1,2}\s+[A-Z][a-z]+\s+\d{4}/)[0];
      events.push({
        title: clean(link.text()),
        url,
        start: when,
        speakers: speakersFromPhrase(lead),
        online: /\bonline\b/i.test(lead) && !/\bin[\s-]person\b|\bhybrid\b|\band online\b|\bonline and\b/i.test(lead) ? true : null,
        hints: [lead],
      });
    });

    return enrichAll(ctx, events.filter((e) => !ctx.isBeyondHorizon(e.start)), 3, async (event) => {
      const page = loadHtml(await ctx.http.text(event.url));
      const paras = page(".entry-content p").map((_, p) => clean(page(p).text())).get();
      const body = paras.filter((t) => t.length > 80 && !/click here/i.test(t));
      // The first line restates format + venue: "… 12 October 2026 19:00 BST at the Army and Navy Club."
      const intro = paras.slice(0, 2).join(" ");
      const venue = intro.match(/\b(?:BST|GMT|\d{1,2}[:.]\d{2}|\d{4})\s*,?\s+(?:at|in)\s+(?:the\s+)?([A-Z][^.;]{3,80}?)(?:[.;]|\s+[-–]\s|$)/)?.[1]
        ?? intro.match(/\blecture\s+at\s+(?:the\s+)?([A-Z][^,.;]{3,80})/)?.[1];
      const hybrid = /\bin[\s-]person\b|\bhybrid\b|\battend in person\b/i.test(paras.join(" "));
      return {
        ...event,
        online: hybrid ? false : event.online,
        location: hybrid || !event.online ? (venue ? clean(venue) : null) : "Online",
        description: body.slice(0, 2).join(" ") || null,
        hints: [...(event.hints ?? []), paras.join(" ").slice(0, 2000)],
      };
    }, (e) => e.url);
  },
};
