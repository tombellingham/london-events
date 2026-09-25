/**
 * London Fortean Society — events are announced as Blogger posts, so we page
 * through the blog's JSON feed and read the semi-structured text each post
 * uses: "Date: Tuesday 27 October 2026 · Time: 8pm (Doors 7.30) · Venue: The
 * Bell, 50 Middlesex Street · Tickets £5/£3" (monthly pub talks), or a date
 * line, time range, price list and a Conway Hall address (bigger events).
 *
 * Round-up posts that list several future dates are skipped: every talk gets
 * its own post with the details 5–6 weeks ahead.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseDate, parseTime } from "../core/dates.ts";
import { clean, htmlToLines, labelled, speakersFromTitle } from "../core/text.ts";

const BLOG = "https://forteanlondon.blogspot.com";
const PAGE = 25;

interface BloggerEntry {
  title: { $t: string };
  content?: { $t: string };
  published: { $t: string };
  link: Array<{ rel: string; href: string }>;
}
interface BloggerFeed {
  feed: { entry?: BloggerEntry[]; "openSearch$totalResults"?: { $t: string } };
}

const POSTCODE = /\b(?:E|EC|N|NW|SE|SW|W|WC)\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/;

export function parseFortPost(title: string, html: string, url: string, now = new Date()): RawEvent | null {
  const lines = htmlToLines(html);
  const text = lines.join("\n");

  // A round-up of several talks (e.g. "Still to come this year at the Bell") isn't one event.
  const dates = new Set(lines.map((l) => parseDate(l, now)).filter(Boolean));
  const dateLine = labelled(lines, /date/i);
  if (!dateLine && dates.size > 2) return null;

  const date = parseDate(dateLine ?? "", now) ?? lines.map((l) => parseDate(l, now)).find(Boolean) ?? null;
  if (!date) return null;

  const timeLine = labelled(lines, /time/i) ?? lines.find((l) => parseDate(l, now) === date && parseTime(l.replace(/\d{4}/, ""))) ?? lines.find((l) => /\b\d{1,2}(?:[.:]\d{2})?\s*[ap]\.?m\b/i.test(l));
  const time = timeLine ? parseTime(timeLine.replace(/\b\d{4}\b/, "")) : null;

  const venue = labelled(lines, /venue|location|where/i) ?? lines.find((l) => POSTCODE.test(l) && l.length < 160) ?? null;
  const tickets = labelled(lines, /tickets?/i) ?? lines.find((l) => /£\s?\d/.test(l)) ?? null;

  // Description: the first substantial prose lines that aren't the logistics.
  const description = lines
    .filter((l) => l.length > 80 && !/^(?:date|time|venue|tickets?)\s*:/i.test(l))
    .slice(0, 2)
    .join(" ");

  return {
    title,
    url,
    start: { date, time },
    location: venue ? venue.replace(/\s*\((?:tubes?|nearest)[^)]*\)\s*/i, " ").trim() : null,
    description: description || null,
    priceText: tickets,
    speakers: speakersFromTitle(title, text),
    hints: [text.slice(0, 1500)],
  };
}

export const fortean: Source = {
  id: "fortean",
  name: "London Fortean Society",
  homepage: BLOG,
  defaults: { free: false },
  async scrape(ctx) {
    const events: RawEvent[] = [];
    // Talks are posted ~6 weeks ahead, so the newest few pages always cover the window.
    for (let start = 1; start <= 4 * PAGE; start += PAGE) {
      const data = await ctx.http.json<BloggerFeed>(`${BLOG}/feeds/posts/default?alt=json&max-results=${PAGE}&start-index=${start}`);
      const entries = data.feed.entry ?? [];
      for (const entry of entries) {
        const url = entry.link.find((l) => l.rel === "alternate")?.href;
        if (!url) continue;
        const event = parseFortPost(clean(entry.title.$t), entry.content?.$t ?? "", url);
        if (event) events.push(event);
      }
      // Stop once posts are older than ~4 months: nothing that old announces a future talk.
      const oldest = entries.at(-1)?.published.$t;
      if (entries.length < PAGE || (oldest && Date.now() - Date.parse(oldest) > 120 * 86_400_000)) break;
    }
    return events;
  },
};
