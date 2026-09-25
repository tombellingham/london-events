/**
 * Royal Astronomical Society — the "Dates for the diary" view on
 * /events-and-meetings (Drupal, ?page=N) lists every upcoming meeting with
 * its local start time. The machine-readable datetime attributes on that
 * view are inconsistent about timezones, so we trust the visible text, and
 * take venue + description from each event page.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseDate, parseTime } from "../core/dates.ts";
import { absUrl, loadHtml } from "../core/html.ts";
import { clean, speakersFromTitle } from "../core/text.ts";
import { enrichAll } from "../core/async.ts";
import { laterPage } from "../core/fetch.ts";

const SITE = "https://ras.ac.uk";

export const ras: Source = {
  id: "ras",
  name: "Royal Astronomical Society",
  homepage: `${SITE}/events-and-meetings`,
  defaults: { location: "Royal Astronomical Society, Burlington House, Piccadilly" },
  async scrape(ctx) {
    const events: RawEvent[] = [];
    for (let page = 0; page < 12; page++) {
      const html = await laterPage(ctx, page, 0, () => ctx.http.text(`${SITE}/events-and-meetings?page=${page}`));
      if (html === null) break;
      const $ = loadHtml(html);
      const rows = $(".view-dates-for-the-dairy .event-iten");
      if (rows.length === 0) break;
      let beyond = 0;
      rows.each((_, el) => {
        const row = $(el);
        const link = row.find(".views-field-title a").first();
        const url = absUrl(link.attr("href"), SITE);
        const day = clean(row.find(".views-field-field-date-1").text());
        const monthYear = clean(row.find(".views-field-field-date-2").text());
        const date = parseDate(`${day} ${monthYear}`);
        if (!url || !date) return;
        if (ctx.isBeyondHorizon(date)) beyond++;
        events.push({
          title: clean(link.text()),
          url,
          start: { date, time: parseTime(clean(row.find(".views-field-field-date").text())) },
          hints: [clean(row.find(".views-field-field-event-type").text())],
          tags: [clean(row.find(".views-field-field-event-type").text())].filter(Boolean),
        });
      });
      if (beyond === rows.length || !$(`a[href="?page=${page + 1}"]`).length) break;
    }

    const inWindow = events.filter((e) => ctx.inWindow(e.start));
    return enrichAll(ctx, inWindow, 3, async (event) => {
      const $ = loadHtml(await ctx.http.text(event.url));
      const content = clean($(".field--name-field-content").first().text()) || clean($(".field--name-body").first().text());
      const venue = clean($(".field--name-field-venue-address .field--name-name").first().text()) || clean($(".field--name-field-venue-address").first().text().replace(/venue address/i, "").replace(/map[\s\S]*$/i, ""));
      const start = clean($(".field--name-field-date").first().text()); // "Start Date Mon, 28/09/2026 - 18:00"
      const date = parseDate(start) ?? (event.start as { date: string }).date;
      return {
        ...event,
        start: { date, time: parseTime(start.replace(/\d{1,2}\/\d{1,2}\/\d{4}/, "")) ?? (event.start as { time: string | null }).time },
        location: venue ? venue.replace(/,(?=\S)/g, ", ") : null,
        description: content || null,
        speakers: speakersFromTitle(event.title, content),
        hints: [...(event.hints ?? []), content],
      };
    }, (e) => e.url);
  },
};
