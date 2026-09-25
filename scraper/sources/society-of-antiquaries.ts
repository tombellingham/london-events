/**
 * Society of Antiquaries of London — WordPress + Sugar Calendar. The events
 * archive lists each event with "floating" (London wall-clock) start times
 * and a short description, paginated as /events/page/N/.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseNaiveLondon } from "../core/dates.ts";
import { absUrl, loadHtml } from "../core/html.ts";
import { clean, honorificNames } from "../core/text.ts";
import { enrichAll } from "../core/async.ts";
import { fetchHtml, laterPage } from "../core/fetch.ts";

const SITE = "https://www.sal.org.uk";

export const societyOfAntiquaries: Source = {
  id: "society-of-antiquaries",
  name: "Society of Antiquaries",
  homepage: `${SITE}/events/`,
  defaults: { location: "Society of Antiquaries, Burlington House, Piccadilly" },
  async scrape(ctx) {
    const events: RawEvent[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= 10; page++) {
      const listing = `${SITE}/events/${page > 1 ? `page/${page}/` : ""}`;
      const html = await laterPage(ctx, page, 1, () => fetchHtml(ctx, listing, { http: { allowStatus: [404] } }));
      if (html === null) break;
      const $ = loadHtml(html);
      const items = $(".sugar-calendar-event-list-block__listview__event");
      if (items.length === 0) break;
      let beyond = 0;
      items.each((_, el) => {
        const item = $(el);
        const link = item.find(".sugar-calendar-event-list-block__event__title a").first();
        const url = absUrl(link.attr("href"), SITE);
        const times = item.find(".sugar-calendar-event-list-block__event__datetime time[datetime]").map((_, t) => $(t).attr("datetime")).get();
        const start = times[0] ? parseNaiveLondon(times[0]) : null;
        if (!url || !start || seen.has(`${url}|${start.date}`)) return;
        seen.add(`${url}|${start.date}`);
        if (ctx.isBeyondHorizon(start)) beyond++;
        const description = clean(item.find(".sugar-calendar-event-list-block__event__desc").text());
        const title = clean(link.text());
        events.push({
          title,
          url,
          start,
          end: times.length > 1 ? parseNaiveLondon(times[times.length - 1]) : null,
          description: description || null,
          speakers: honorificNames(description),
        });
      });
      if (beyond === items.length || !$(`a[href*="/events/page/${page + 1}/"]`).length) break;
    }
    const inWindow = events.filter((e) => ctx.inWindow(e.start));
    return enrichAll(ctx, inWindow, 2, async (event) => {
      const $ = loadHtml(await fetchHtml(ctx, event.url));
      const body = $(".sc-frontend-single-event__description, .entry-content, article").first();
      const paras = body.find("p").map((_, p) => clean($(p).text())).get().filter((t) => t.length > 40);
      const text = paras.join(" ");
      const price = text.match(/[^.]*(?:£\s?\d|\bfree\b)[^.]*\./i)?.[0] ?? null;
      return {
        ...event,
        description: paras.slice(0, 2).join(" ") || event.description,
        priceText: price,
        speakers: honorificNames(`${event.description ?? ""} ${text}`),
        hints: [text.slice(0, 2000)],
      };
    }, (e) => e.url);
  },
};
