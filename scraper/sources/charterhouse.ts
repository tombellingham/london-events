/**
 * The Charterhouse — the What's On page is rendered client-side from a custom
 * WordPress REST route (/wp-json/custom/events), paginated with page/ppp.
 * Timestamps are London wall-clock values encoded as if they were UTC, so we
 * read their digits back as London time. Daily tours and service schedules
 * (entries spanning weeks) are dropped by the normalizer's long-run rule.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseIsoAsLondonWallClock } from "../core/dates.ts";
import { loadHtml } from "../core/html.ts";
import { clean } from "../core/text.ts";
import { enrichAll } from "../core/async.ts";

const SITE = "https://thecharterhouse.org";
const PPP = 50;

interface ChEvent {
  id: string;
  title: string;
  body?: string;
  url: string;
  startDate: number;
  endDate?: number;
  eventDatesDisplay?: string;
}

const wallClock = (unix: number) => parseIsoAsLondonWallClock(new Date(unix * 1000).toISOString());

export const charterhouse: Source = {
  id: "charterhouse",
  name: "The Charterhouse",
  homepage: `${SITE}/visit-us/whats-on/`,
  // Tours and talks are ticketed unless the page says otherwise.
  defaults: { location: "The Charterhouse, Charterhouse Square, EC1M 6AN", online: false, free: false },
  async scrape(ctx) {
    const from = Math.floor(ctx.horizon.from.getTime() / 1000);
    const events: RawEvent[] = [];
    for (let page = 1; page <= 20; page++) {
      const data = await ctx.http.json<{ results: ChEvent[]; total: number }>(`${SITE}/wp-json/custom/events/?from=${from}&ppp=${PPP}&page=${page}`);
      for (const e of data.results ?? []) {
        const start = wallClock(e.startDate);
        if (!start) continue;
        // Recurring tours list their *next* slot; the span tells us it's a series.
        events.push({
          title: e.title,
          url: e.url,
          start,
          end: e.endDate ? wallClock(e.endDate) : null,
          description: e.body ?? null,
          hints: [e.eventDatesDisplay ?? ""],
        });
      }
      if ((data.results ?? []).length < PPP) break;
    }

    // Prices and fuller descriptions live on each event page.
    const inWindow = events.filter((e) => !ctx.isBeyondHorizon(e.start as never));
    return enrichAll(ctx, inWindow, 2, async (event) => {
      const $ = loadHtml(await ctx.http.text(event.url));
      $("header, nav, footer, script, style").remove();
      const paragraphs = $("p").map((_, p) => clean($(p).text())).get().filter((t) => t.length > 60);
      const text = paragraphs.join(" ");
      const price = text.match(/(?:tickets?|price|cost|admission)[^.£]{0,40}(£\s?\d[\d.]*(?:[^.]{0,60}£\s?\d[\d.]*)?|free)/i)?.[1] ?? null;
      return { ...event, priceText: price, description: paragraphs.slice(0, 2).join(" ") || event.description, hints: [...(event.hints ?? []), text] };
    }, (e) => e.url);
  },
};
