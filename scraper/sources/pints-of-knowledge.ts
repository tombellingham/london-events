/**
 * Pints of Knowledge — pub talks sold through Ticket Tailor. The box-office
 * page lists every upcoming talk with "Mon 28 Sep 2026 7:00 PM - 8:30 PM"
 * and "Pizza East, E1 6JJ"; each event page adds schema.org Event JSON-LD
 * whose description starts with "With <speaker> (<affiliation>)".
 *
 * Ticket Tailor sits behind Cloudflare and only answers a real browser from
 * CI, so pages go through fetchHtml's browser fallback.
 */

import type { LondonDateTime, RawEvent, Source } from "../core/types.ts";
import { absUrl, hasType, jsonLdNodes, loadHtml } from "../core/html.ts";
import { clean, cleanName, htmlToText, looksLikeName, speakersFromTitle, uniqNames } from "../core/text.ts";
import { parseDateTime, parseIsoInstant } from "../core/dates.ts";
import { enrichAll } from "../core/async.ts";
import { fetchHtml, laterPage, preferBrowser } from "../core/fetch.ts";

const SITE = "https://www.tickettailor.com";
const BOX_OFFICE = `${SITE}/events/pintsofknowledge`;

// Plain requests from CI always meet a bot wall here.
preferBrowser("www.tickettailor.com");

type Listed = RawEvent & { start: LondonDateTime };

/** "…London"With Jonnie Fielding (Bowl of Chalk)\nDetails:…" → ["Jonnie Fielding"]. */
export function pokSpeakers(description: string): string[] {
  const m = description.match(/\bwith\s+([^\n]+?)(?:\n|details\s*:|$)/i);
  if (!m) return [];
  return m[1]
    .replace(/\([^)]*\)/g, " ")
    .split(/\s*(?:,|&|\band\b)\s*/)
    .map(cleanName)
    .filter(looksLikeName);
}

export const pintsOfKnowledge: Source = {
  id: "pints-of-knowledge",
  name: "Pints of Knowledge",
  homepage: BOX_OFFICE,
  timeoutMs: 480_000,
  defaults: { free: false, online: false },
  async scrape(ctx) {
    const listed: Listed[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= 5; page++) {
      const html = await laterPage(ctx, page, 1, () => fetchHtml(ctx, page > 1 ? `${BOX_OFFICE}?page=${page}` : BOX_OFFICE, { browser: { waitFor: ".events-listing__item" } }));
      if (html === null) break;
      const $ = loadHtml(html);
      let added = 0;
      $(".events-listing__item").each((_, el) => {
        const item = $(el);
        const link = item.find(".event__title a").first();
        const url = absUrl(link.attr("href"), SITE);
        const start = parseDateTime(clean(item.find(".event-meta__date").first().text()));
        if (!url || !start || seen.has(url)) return;
        seen.add(url);
        added++;
        const title = clean(link.text());
        listed.push({
          title,
          url,
          start,
          location: clean(item.find(".event-meta__location").first().text()) || null,
          speakers: speakersFromTitle(title),
          hints: [clean(item.find(".event__cta--book").first().text())],
        });
      });
      // Ticket Tailor normally lists everything on one page; follow ?page= only while it yields new events.
      if (!added || !$(`a[href*="page=${page + 1}"]`).length) break;
    }

    const inWindow = listed.filter((e) => ctx.inWindow(e.start));
    return enrichAll<RawEvent>(
      ctx,
      inWindow,
      3,
      async (event) => {
        const $ = loadHtml(await fetchHtml(ctx, event.url, { browser: { waitFor: "script[type='application/ld+json']" } }));
        const node = jsonLdNodes($).find((n) => hasType(n, /Event/));
        if (!node) return event;
        const description = htmlToText(String(node.description ?? ""));
        const instant = typeof node.startDate === "string" ? parseIsoInstant(node.startDate) : null;
        return {
          ...event,
          start: instant ?? event.start,
          description: description || null,
          speakers: uniqNames([...pokSpeakers(String(node.description ?? "")), ...(event.speakers ?? [])]),
        };
      },
      (e) => e.url,
    );
  },
};
