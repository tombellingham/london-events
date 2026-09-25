/**
 * Royal Society of Medicine — /events/ lists upcoming events as
 * `.m-event-block` cards: <time datetime="2026-01-15T13:30:00T"> (naive
 * London), a format tag (Webinar, Conference, …), title link, summary and a
 * "Location" meta row.
 *
 * Known limitation: rsm.ac.uk sits behind a Cloudflare managed challenge
 * that neither plain requests nor a real browser on GitHub's runners get
 * past, so this source currently reports "failed" in the health table. The
 * scraper is kept so it recovers on its own if the protection relaxes.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { absUrl, loadHtml } from "../core/html.ts";
import { clean, honorificNames } from "../core/text.ts";
import { parseNaiveLondon } from "../core/dates.ts";
import { fetchHtml } from "../core/fetch.ts";

const SITE = "https://www.rsm.ac.uk";

export const rsm: Source = {
  id: "rsm",
  name: "Royal Society of Medicine",
  homepage: `${SITE}/events/`,
  defaults: { free: false, location: "Royal Society of Medicine, 1 Wimpole Street, W1G 0AE" },
  async scrape(ctx) {
    const $ = loadHtml(await fetchHtml(ctx, `${SITE}/events/`, { browser: { waitFor: ".m-event-block" } }));
    const events: RawEvent[] = [];
    $(".m-event-block").each((_, el) => {
      const block = $(el);
      const link = block.find(".m-event-block__link").first();
      const url = absUrl(link.attr("href"), SITE);
      const start = parseNaiveLondon(block.find("time[datetime]").first().attr("datetime") ?? "");
      if (!url || !start) return;
      const tag = clean(block.find(".m-event-block__tags").text());
      let location: string | null = null;
      block.find(".m-event-block__meta-item").each((_, item) => {
        if (/location/i.test(clean($(item).find(".m-event-block__meta-key").text()))) {
          location = clean($(item).find(".m-event-block__meta-value").text()) || null;
        }
      });
      const description = clean(block.find(".m-event-block__content").text());
      events.push({
        title: clean(link.text()),
        url,
        start,
        location: /webinar|online/i.test(tag) ? "Online" : location,
        online: /webinar|online/i.test(tag) ? true : null,
        description: description || null,
        speakers: honorificNames(description),
        hints: [tag],
      });
    });
    return events;
  },
};
