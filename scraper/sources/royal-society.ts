/**
 * Royal Society — two server-rendered listings: public events (prize
 * lectures, "See X Differently" evenings, exhibitions) and scientific
 * meetings. Cards give date, price ("Free"), "Watch online" and venue; the
 * start time comes from each event page. Some scientific meetings are held
 * outside London (Edinburgh etc.) and are dropped by the London filter.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseDate, parseTime } from "../core/dates.ts";
import { absUrl, loadHtml } from "../core/html.ts";
import { clean, honorificNames, speakersFromPhrase, uniqNames } from "../core/text.ts";
import { enrichAll } from "../core/async.ts";
import { configureHost } from "../core/http.ts";

configureHost("royalsociety.org", { concurrency: 1, intervalMs: 1500 });

const SITE = "https://royalsociety.org";
const LISTINGS = [`${SITE}/science-events-and-lectures/public/`, `${SITE}/science-events-and-lectures/scientific/`];

export const royalSociety: Source = {
  id: "royal-society",
  name: "Royal Society",
  homepage: `${SITE}/science-events-and-lectures/`,
  defaults: { free: true, location: "The Royal Society, 6–9 Carlton House Terrace, SW1Y 5AG" },
  async scrape(ctx) {
    const events: RawEvent[] = [];
    const seen = new Set<string>();
    for (const listing of LISTINGS) {
      let url: string | null = listing;
      for (let page = 1; url && page <= 10; page++) {
        const $ = loadHtml(await ctx.http.text(url));
        $("a.card__link").each((_, el) => {
          const card = $(el);
          const href = absUrl(card.attr("href"), SITE);
          if (!href || seen.has(href)) return;
          seen.add(href);
          const dateText = clean(card.find("time").first().text()); // "14 October 2026" or "05 October - 06 October 2026"
          const [startPart, endPart] = dateText.split(/\s+-\s+/);
          const yearMatch = dateText.match(/\b\d{4}\b/)?.[0] ?? "";
          const date = parseDate(/\d{4}/.test(startPart) ? startPart : `${startPart} ${yearMatch}`);
          if (!date) return;
          const meta = card.find(".card__meta-item").map((_, m) => clean($(m).text())).get();
          const venue = meta.find((m) => !/^(?:free|watch online|£)/i.test(m)) ?? null;
          events.push({
            title: clean(card.find(".card__title").first().text()),
            url: href,
            start: { date, time: null },
            end: endPart ? { date: parseDate(endPart) ?? date, time: null } : null,
            location: venue,
            description: clean(card.find(".card__desc, .card__text, p").first().text()) || null,
            priceText: meta.find((m) => /^(?:free|£)/i.test(m)) ?? null,
            hints: meta,
          });
        });
        const next = $('link[rel="next"]').attr("href") ?? $('a[rel="next"]').attr("href");
        url = next ? absUrl(next, SITE) : null;
      }
    }

    const inWindow = events.filter((e) => ctx.inWindow(e.start));
    return enrichAll(ctx, inWindow, 2, async (event) => {
      const $ = loadHtml(await ctx.http.text(event.url));
      const main = $("main").first();
      const text = clean(main.text());
      const timeText = text.match(/\b\d{1,2}[:.]\d{2}\s*(?:-|–)\s*\d{1,2}[:.]\d{2}\b/)?.[0] ?? "";
      const paras = main.find("p").map((_, p) => clean($(p).text())).get().filter((t) => t.length > 80);
      return {
        ...event,
        start: { date: (event.start as { date: string }).date, time: parseTime(timeText) },
        description: paras.slice(0, 2).join(" ") || event.description,
        speakers: uniqNames([...speakersFromPhrase(paras[0] ?? ""), ...honorificNames(paras.slice(0, 2).join(" "))]),
        hints: [...(event.hints ?? []), paras.join(" ").slice(0, 1500)],
      };
    }, (e) => e.url);
  },
};
