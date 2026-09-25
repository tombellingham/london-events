/**
 * Guardian Live — each event is a Guardian "article" under
 * /guardian-live-events/YYYY/mon/DD/slug whose standfirst/body carry
 * "Date:", "Time(s):" and "Location:" lines plus a prices sentence. We gather
 * candidate event URLs from the section RSS feed (including the "About
 * Guardian Live" post, which keeps an up-to-date list of upcoming events)
 * and from the section front, then parse each article.
 *
 * Many events are livestream-only or in other cities; normalize.ts keeps the
 * in-person London ones.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseDate, parseTime } from "../core/dates.ts";
import { absUrl, loadHtml } from "../core/html.ts";
import { clean, htmlToLines, labelled, speakersFromTitle, uniqNames } from "../core/text.ts";
import { mapSettled } from "../core/async.ts";

const SECTION = "https://www.theguardian.com/guardian-live-events";
const EVENT_URL = /^https:\/\/www\.theguardian\.com\/guardian-live-events\/\d{4}\/[a-z]{3}\/\d{2}\/[\w-]+$/;
const NOT_EVENTS = /about-guardian-live|newsletter|terms-and-conditions|faq|how-to-watch|gift/;

function collectLinks(html: string, base: string, into: Set<string>): void {
  const $ = loadHtml(html);
  $("a[href]").each((_, a) => {
    const url = absUrl($(a).attr("href"), base)?.split(/[?#]/)[0];
    if (url && EVENT_URL.test(url) && !NOT_EVENTS.test(url)) into.add(url);
  });
}

function speakersFromBody(lines: string[]): string[] {
  const names: string[] = [];
  const start = lines.findIndex((l) => /^(?:speaker|speakers|about the speakers?|speaker information)$/i.test(l));
  if (start < 0) return names;
  for (const line of lines.slice(start + 1, start + 12)) {
    const m = line.match(/^([A-Z][\p{L}'’.\- ]{2,60}?)\s+(?:is|was|are|has|will|,)\b/u);
    if (m) names.push(m[1]);
    else if (names.length) break;
  }
  return names;
}

export function parseGuardianLiveArticle(html: string, url: string, now = new Date()): RawEvent | null {
  const $ = loadHtml(html);
  const title = clean($('meta[property="og:title"]').attr("content") ?? $("h1").first().text());
  const standfirstHtml = $('[data-gu-name="standfirst"]').html() ?? "";
  const bodyHtml = $('[data-gu-name="body"]').html() ?? $("article").html() ?? "";
  const lines = [...htmlToLines(standfirstHtml), ...htmlToLines(bodyHtml)];

  const date = parseDate(labelled(lines, /date/i) ?? "", now);
  if (!date) return null;
  const time = parseTime(labelled(lines, /times?/i) ?? "");
  const location = labelled(lines, /location|venue/i);
  const priceLine = lines.find((l) => /£\s?\d/.test(l) && /ticket|price|cost|livestream|in person/i.test(l)) ?? "";
  const priceText = priceLine.match(/[^.]*£\s?\d[^.]*(?:\.\d+[^.]*)*\.?/g)?.join(" ") ?? null;
  const bodySpeakers = speakersFromBody(lines);

  return {
    title,
    url,
    start: { date, time },
    location,
    description: $('meta[property="og:description"]').attr("content") ?? null,
    // The "Speaker information" section is reliable; title prefixes ("X and Y: …") only as a fallback.
    speakers: bodySpeakers.length ? uniqNames(bodySpeakers) : speakersFromTitle(title, lines.join(" ")),
    priceText,
    hints: [location ?? "", lines.slice(0, 40).join(" ")],
  };
}

export const guardianLive: Source = {
  id: "guardian-live",
  name: "Guardian Live",
  homepage: SECTION,
  defaults: { free: false },
  async scrape(ctx) {
    const urls = new Set<string>();
    const rss = await ctx.http.text(`${SECTION}/rss`);
    const feed = loadHtml(rss);
    feed("item").each((_, item) => {
      const link = clean(feed(item).find("link").text());
      if (EVENT_URL.test(link) && !NOT_EVENTS.test(link)) urls.add(link);
      // The "About Guardian Live events" item lists every upcoming event.
      collectLinks(feed(item).find("description").text(), SECTION, urls);
    });
    collectLinks(await ctx.http.text(SECTION), SECTION, urls);
    ctx.log.info(`${urls.size} candidate event pages`);

    const events = await mapSettled(
      [...urls],
      3,
      async (url) => parseGuardianLiveArticle(await ctx.http.text(url), url),
      (url, err) => ctx.log.warn(`failed ${url}: ${String(err)}`),
    );
    return events.filter((e): e is RawEvent => e !== null);
  },
};
