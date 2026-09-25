/**
 * School of Advanced Study (University of London) — the events page is a
 * Drupal "filter listing" whose results come from a JSON endpoint,
 * /api/listing/15886 (12 per page, soonest first, ?page=N). The page and
 * the endpoint sit behind Cloudflare: the endpoint is only reachable from
 * inside a real browser that has loaded the page, so it's fetched in-page.
 *
 * The endpoint's items are read tolerantly (structured fields or rendered
 * teaser HTML), and every event page is then read for the details, since
 * teasers are brief.
 */

import type { LondonDateTime, RawEvent, Source } from "../core/types.ts";
import { absUrl, hasType, jsonLdNodes, loadHtml } from "../core/html.ts";
import { clean, honorificNames, htmlToText, speakersFromTitle } from "../core/text.ts";
import { parseDateTime, parseIsoInstant, parseNaiveLondon, toLondonDateTime } from "../core/dates.ts";
import { enrichAll } from "../core/async.ts";
import { fetchHtml } from "../core/fetch.ts";

const SITE = "https://www.sas.ac.uk";
const PAGE_URL = `${SITE}/news-events/events`;
const API = (page: number) =>
  `${SITE}/api/listing/15886?sort%5Bstart_date%5D%5Bpath%5D=start_date&sort%5Bstart_date%5D%5Bdirection%5D=asc${page ? `&page=${page}` : ""}`;

type Listed = RawEvent & { start: LondonDateTime };
type Json = Record<string, unknown>;

/** The first array of objects in a JSON document (breadth-first). */
function findItems(root: unknown): Json[] {
  const queue: unknown[] = [root];
  while (queue.length) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      if (node.length && node.every((x) => x && typeof x === "object" && !Array.isArray(x))) return node as Json[];
      queue.push(...node);
    } else if (node && typeof node === "object") {
      queue.push(...Object.values(node as Json));
    }
  }
  return [];
}

function when(value: string): LondonDateTime | null {
  const instant = parseIsoInstant(value);
  if (instant) return toLondonDateTime(instant);
  return parseNaiveLondon(value) ?? parseDateTime(value);
}

/** One listing item → event, from structured fields or from rendered teaser markup. */
export function sasItem(item: Json): Listed | null {
  const html = Object.values(item).find((v) => typeof v === "string" && /<a\s[^>]*href=/i.test(v)) as string | undefined;
  if (html) {
    const $ = loadHtml(html);
    const link = $("a[href]").filter((_, a) => /\/events?\//.test($(a).attr("href") ?? "")).first();
    const url = absUrl((link.length ? link : $("a[href]").first()).attr("href"), SITE);
    const title = clean($("h2, h3, h4, .title, [class*=title]").first().text()) || clean(link.text());
    const stamp = $("time[datetime]").first().attr("datetime");
    const start = (stamp ? when(stamp) : null) ?? parseDateTime(clean($.root().text()));
    if (!url || !title || !start) return null;
    return { title, url, start, description: clean($("p").first().text()) || null };
  }
  const str = (...keys: string[]) => {
    for (const k of keys) if (typeof item[k] === "string" && item[k]) return item[k] as string;
    return "";
  };
  const title = htmlToText(str("title", "name", "label"));
  const url = absUrl(str("url", "path", "link", "alias"), SITE);
  const start = when(str("start_date", "startDate", "date", "start", "event_start_date"));
  if (!title || !url || !start) return null;
  return { title, url, start, location: htmlToText(str("location", "venue")) || null, description: htmlToText(str("summary", "teaser", "description")) || null };
}

export const sas: Source = {
  id: "sas",
  name: "School of Advanced Study",
  homepage: PAGE_URL,
  defaults: { free: true, location: "Senate House, Malet Street, WC1E 7HU" },
  async scrape(ctx) {
    const listed: Listed[] = [];
    const seen = new Set<string>();
    for (let batch = 0; batch < 4; batch++) {
      // Five API pages per page load (60 events), until we pass the horizon.
      const pages = [0, 1, 2, 3, 4].map((i) => API(batch * 5 + i));
      const bodies = await ctx.browser.fetchFromPage(PAGE_URL, pages).catch((err) => {
        if (batch === 0) throw err;
        ctx.log.warn(`stopped paginating: ${String(err).slice(0, 200)}`);
        return [] as string[];
      });
      let more = false;
      for (const body of bodies) {
        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          throw new Error(`listing endpoint did not return JSON: ${body.slice(0, 120)}`);
        }
        const items = findItems(json);
        for (const item of items) {
          const event = sasItem(item);
          if (!event || seen.has(`${event.url}|${event.start.date}`)) continue;
          seen.add(`${event.url}|${event.start.date}`);
          listed.push(event);
        }
        more = items.length > 0 && !items.map(sasItem).some((e) => e && ctx.isBeyondHorizon(e.start));
        if (!more) break;
      }
      if (!more) break;
    }
    if (!listed.length) throw new Error("listing endpoint returned no recognisable events");

    const inWindow = listed.filter((e) => ctx.inWindow(e.start));
    return enrichAll<RawEvent>(
      ctx,
      inWindow,
      2,
      async (event) => {
        const $ = loadHtml(await fetchHtml(ctx, event.url));
        const node = jsonLdNodes($).find((n) => hasType(n, /Event/));
        const text = clean($("main").text());
        const venue = clean($("[class*=location], [class*=venue]").first().text());
        const description = clean($('meta[name="description"]').attr("content") ?? "") || event.description;
        const start = typeof node?.startDate === "string" ? when(node.startDate) : null;
        const time = start?.time ?? parseDateTime(clean($("[class*=date], time").first().text()))?.time ?? null;
        return {
          ...event,
          start: { date: (event.start as LondonDateTime).date, time: (event.start as LondonDateTime).time ?? time },
          location: venue || event.location,
          description,
          speakers: [...speakersFromTitle(event.title), ...honorificNames(description)],
          hints: [text.slice(0, 3000)],
        };
      },
      (e) => e.url,
    );
  },
};
