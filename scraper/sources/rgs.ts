/**
 * Royal Geographical Society — the "Upcoming events" listing is fed by an
 * Umbraco JSON endpoint (title, date, location, price, category), paginated
 * by pageIndex. Start times only appear on each event page's "Key
 * information" card, so we fetch those for events inside the window.
 *
 * The listing includes regional-branch and partner events; the normalizer
 * keeps London + online ones.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseDate, parseTime } from "../core/dates.ts";
import { absUrl, loadHtml } from "../core/html.ts";
import { clean, trailingSpeaker } from "../core/text.ts";
import { enrichAll } from "../core/async.ts";

const SITE = "https://www.rgs.org";
const API = `${SITE}/umbraco/api/listing/articles`;
const PAGE = 50;

interface RgsItem {
  title: string;
  content?: string;
  cta?: { url?: string };
  additionalCta?: { url?: string };
  date?: string;
  categoryTag?: string;
  location?: string;
  memberAccessType?: string;
  price?: string;
}

export const rgs: Source = {
  id: "rgs",
  name: "Royal Geographical Society",
  homepage: `${SITE}/events/upcoming-events`,
  defaults: { location: "Royal Geographical Society, 1 Kensington Gore, SW7 2AR" },
  async scrape(ctx) {
    const events: RawEvent[] = [];
    for (let pageIndex = 1; pageIndex <= 30; pageIndex++) {
      const data = await ctx.http.json<{ items: RgsItem[]; totalItems: number }>(
        `${API}?docId=1137&pageIndex=${pageIndex}&pageSize=${PAGE}&pageType=events`,
      );
      let beyond = 0;
      for (const item of data.items ?? []) {
        const date = parseDate(item.date ?? "");
        const url = absUrl(item.cta?.url, SITE);
        if (!date || !url) continue;
        if (ctx.isBeyondHorizon(date)) beyond++;
        const location = clean(item.location);
        // `location` is a region: London, Online, "London and online", or a branch town elsewhere.
        const inLondon = /^london(?:\s+and\s+online)?$/i.test(location);
        const onlineElsewhere = !inLondon && /\bonline\b/i.test(location);
        if (!inLondon && !onlineElsewhere) continue;
        // Teacher CPD, careers sessions for students and members-only events aren't public talks.
        if (/^(?:teachers|schools|professionals|postgraduates|undergraduates|early career|members only)$/i.test(clean(item.memberAccessType))) continue;
        events.push({
          title: item.title,
          url,
          start: { date, time: null },
          // bare "London" → the RGS default venue; "Bath and online" → joinable online only
          location: /^london$/i.test(location)
            ? null
            : /^london\s+and\s+online$/i.test(location)
              ? "Royal Geographical Society, Kensington Gore (and online)"
              : onlineElsewhere && !/^online$/i.test(location)
                ? "Online"
                : location,
          online: onlineElsewhere ? true : null,
          description: item.content ?? null,
          priceText: item.price ?? null,
          speakers: trailingSpeaker(item.title),
          hints: [item.categoryTag ?? "", item.memberAccessType ?? ""],
          tags: item.categoryTag ? [item.categoryTag] : [],
        });
      }
      if ((data.items ?? []).length < PAGE || beyond === (data.items ?? []).length) break;
    }

    const inWindow = events.filter((e) => ctx.inWindow(e.start));
    return enrichAll(ctx, inWindow, 3, async (event) => {
      const $ = loadHtml(await ctx.http.text(event.url));
      const facts = $("[class*=KeyInformationCardstyles__Information] span").map((_, el) => clean($(el).text())).get();
      const timeText = facts.find((f) => /\d\s*(?:[.:]\d{2})?\s*(?:am|pm)|\d{1,2}[.:]\d{2}/i.test(f) && !/\b20\d\d\b/.test(f));
      const time = timeText ? parseTime(timeText) : null;
      const venue = facts.find((f) => /online|london|house|hall|centre|theatre|road|street/i.test(f) && f !== event.location);
      return {
        ...event,
        start: { date: (event.start as { date: string }).date, time },
        location: event.location ?? (venue && !/^london$/i.test(venue) ? venue : null),
      };
    }, (e) => e.url);
  },
};
