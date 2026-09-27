/**
 * Pints of Knowledge — pub talks all over London, sold through Ticket Tailor.
 *
 * Ticket Tailor shows automated visitors from cloud machines an interactive
 * Cloudflare check ("Verify you are human"), which never clears on its own.
 * So the listing comes from the feed behind Pints of Knowledge's own "Find a
 * talk near you" map (map.pintsofknowledge.co.uk): every upcoming talk with
 * its venue and address, start time and Ticket Tailor link, per venue.
 *
 * Descriptions and speakers ("With <speaker> (<affiliation>)") are only on
 * the Ticket Tailor event pages, in schema.org Event JSON-LD. Those are read
 * whenever Ticket Tailor lets the browser through; at the first bot check the
 * rest of the day's talks are listed without them. If the map feed is ever
 * unavailable, the Ticket Tailor box office listing is read instead.
 */

import type { LondonDateTime, RawEvent, ScrapeContext, Source } from "../core/types.ts";
import { absUrl, hasType, jsonLdNodes, loadHtml } from "../core/html.ts";
import { clean, cleanName, htmlToText, looksLikeName, speakersFromTitle, uniqNames } from "../core/text.ts";
import { parseDateTime, parseIsoInstant, toLondonDateTime } from "../core/dates.ts";
import { enrichAll, errorMessage } from "../core/async.ts";
import { fetchHtml, isBlocked, laterPage, preferBrowser } from "../core/fetch.ts";

const MAP_FEED = "https://pok-analytics-api.lucky-tree-ecf0.workers.dev/api/map";
const WEBSITE = "https://www.pintsofknowledge.co.uk/london-tickets";
const TICKET_TAILOR = "https://www.tickettailor.com";
const BOX_OFFICE = `${TICKET_TAILOR}/events/pintsofknowledge`;

// Plain requests to Ticket Tailor always meet a bot wall from CI.
preferBrowser("www.tickettailor.com");

type Listed = RawEvent & { start: LondonDateTime };

interface FeedEvent {
  title?: string;
  /** Unix seconds. */
  start_at?: number;
  event_url?: string;
  checkout_url?: string;
  status?: string;
}

export interface MapFeed {
  venues?: Array<{ name?: string; address?: string; upcoming_events?: FeedEvent[] }>;
}

/** The map feed → one listing per published talk, at "<venue>, <address>". */
export function pokFeedEvents(feed: MapFeed): Listed[] {
  const out: Listed[] = [];
  const seen = new Set<string>();
  for (const venue of feed.venues ?? []) {
    const location = [clean(venue.name ?? ""), clean(venue.address ?? "")].filter(Boolean).join(", ") || null;
    for (const e of venue.upcoming_events ?? []) {
      const url = e.event_url || e.checkout_url;
      const title = clean(e.title ?? "");
      if (!title || !url || typeof e.start_at !== "number" || (e.status && e.status !== "published") || seen.has(url)) continue;
      seen.add(url);
      out.push({ title, url, start: toLondonDateTime(new Date(e.start_at * 1000)), location, speakers: speakersFromTitle(title) });
    }
  }
  return out;
}

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

/** The fallback listing: Ticket Tailor's box office ("Mon 28 Sep 2026 7:00 PM - 8:30 PM", "Pizza East, E1 6JJ"). */
async function fromBoxOffice(ctx: ScrapeContext): Promise<Listed[]> {
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
      const url = absUrl(link.attr("href"), TICKET_TAILOR);
      const start = parseDateTime(clean(item.find(".event-meta__date").first().text()));
      if (!url || !start || seen.has(url)) return;
      seen.add(url);
      added++;
      const title = clean(link.text());
      listed.push({ title, url, start, location: clean(item.find(".event-meta__location").first().text()) || null, speakers: speakersFromTitle(title) });
    });
    // Ticket Tailor normally lists everything on one page; follow ?page= only while it yields new events.
    if (!added || !$(`a[href*="page=${page + 1}"]`).length) break;
  }
  return listed;
}

export const pintsOfKnowledge: Source = {
  id: "pints-of-knowledge",
  name: "Pints of Knowledge",
  homepage: WEBSITE,
  timeoutMs: 480_000,
  defaults: { free: false, online: false },
  async scrape(ctx) {
    let listed: Listed[];
    try {
      listed = pokFeedEvents(await ctx.http.json<MapFeed>(MAP_FEED));
      if (!listed.length) throw new Error("no talks in it");
    } catch (err) {
      ctx.log.warn(`map feed unusable (${errorMessage(err)}); reading the Ticket Tailor box office instead`);
      listed = await fromBoxOffice(ctx);
    }

    let walled = false;
    return enrichAll<RawEvent>(
      ctx,
      listed.filter((e) => ctx.inWindow(e.start)),
      2,
      async (event) => {
        if (walled) return event;
        let html: string;
        try {
          html = await fetchHtml(ctx, event.url, { browser: { waitFor: "script[type='application/ld+json']" } });
        } catch (err) {
          if (!isBlocked(err)) throw err;
          if (!walled) ctx.log.warn("Ticket Tailor put up a bot check: talks listed without descriptions or speakers");
          walled = true;
          return event;
        }
        const node = jsonLdNodes(loadHtml(html)).find((n) => hasType(n, /Event/));
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
