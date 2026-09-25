/**
 * School of Advanced Study (University of London) — the events page is a
 * Drupal "filter listing" fed by /api/listing/15886 (12 per page, ?page=N
 * from 0, soonest first), which returns
 *   { items: [{ bundle: "event", markup: "<article>…teaser…</article>" }], meta: { count } }.
 * Teasers carry the link, title, organising institute and start/end dates
 * (date-only: the time part is a noon placeholder); the event page has the
 * time, venue and description.
 *
 * Everything sits behind Cloudflare and is only reachable from inside a real
 * browser that has loaded the events page, so the API and the event pages
 * are all fetched in-page (BrowserPool.inPage) rather than page by page.
 */

import type { LondonDateTime, RawEvent, Source } from "../core/types.ts";
import { absUrl, hasType, jsonLdNodes, labelledValue, loadHtml } from "../core/html.ts";
import { clean, honorificNames, htmlToLines, labelled, speakersFromTitle } from "../core/text.ts";
import { parseDateTime, parseNaiveLondon, parseTime } from "../core/dates.ts";
import { mapLimit } from "../core/async.ts";

const SITE = "https://www.sas.ac.uk";
const PAGE_URL = `${SITE}/news-events/events`;
const PER_PAGE = 12;
const API = (page: number) =>
  `${SITE}/api/listing/15886?sort%5Bstart_date%5D%5Bpath%5D=start_date&sort%5Bstart_date%5D%5Bdirection%5D=asc${page ? `&page=${page}` : ""}`;
// Not public talks: calls for papers, training, courses, internal sessions.
const NOT_EVENTS = /\b(?:call for (?:papers|proposals|applications)|cfp|research training|training|short course|course|workshop|reading group|induction|open day|deadline)\b/i;

type Listed = RawEvent & { start: LondonDateTime; organiser: string };

interface ListingResponse {
  items?: Array<{ bundle?: string; markup?: string }>;
  meta?: { count?: number };
}

/** A teaser from the listing API → event (date only; the time comes from the event page). */
export function sasTeaser(markup: string): Listed | null {
  const $ = loadHtml(markup);
  const url = absUrl($("a[href]").first().attr("href"), SITE);
  const title = clean($("h3").first().text());
  const times = $("time[datetime]")
    .map((_, t) => $(t).attr("datetime") ?? "")
    .get();
  const start = times[0] ? parseNaiveLondon(times[0].slice(0, 10)) : null;
  const end = times[1] ? parseNaiveLondon(times[1].slice(0, 10)) : null;
  if (!url || !title || !start) return null;
  const organiser = clean($("h3").first().next().text());
  return { title, url, start: { date: start.date, time: null }, end, organiser };
}

/** Time, venue and description from an event page ("Label: value" lines or <dt>/<dd>-style fields). */
export function sasDetails(html: string): { time: string | null; location: string | null; description: string | null; text: string; type: string } {
  const $ = loadHtml(html);
  const node = jsonLdNodes($).find((n) => hasType(n, /Event/));
  const main = $("main").first();
  const lines = htmlToLines(main.html() ?? "");
  const field = (label: RegExp, inline: RegExp) => labelledValue($, label, main) ?? labelled(lines, inline);
  const start = typeof node?.startDate === "string" ? parseNaiveLondon(node.startDate.replace(/([zZ]|[+-]\d{2}:?\d{2})$/, "")) : null;
  const time = start?.time ?? parseTime(field(/^(?:time|start time|times?)$/i, /time/i) ?? "") ?? parseDateTime(field(/^(?:date|dates|date and time|date & time|when)$/i, /date/i) ?? "")?.time ?? null;
  const location = field(/^(?:venue|location|where|address)$/i, /(?:venue|location|where)/i);
  const description = clean($('meta[name="description"]').attr("content") ?? "") || null;
  return { time, location: location ? clean(location) : null, description, text: lines.join("\n"), type: field(/^(?:event type|type)$/i, /event type/i) ?? "" };
}

export const sas: Source = {
  id: "sas",
  name: "School of Advanced Study",
  homepage: PAGE_URL,
  defaults: { free: true, location: "Senate House, Malet Street, WC1E 7HU" },
  timeoutMs: 360_000,
  async scrape(ctx) {
    return ctx.browser.inPage(PAGE_URL, async (get) => {
      const listed: Listed[] = [];
      const seen = new Set<string>();
      let pages = 1;
      for (let page = 0; page < Math.min(pages, 25); page++) {
        const data = JSON.parse(await get(API(page))) as ListingResponse;
        if (!Array.isArray(data.items)) throw new Error("listing API shape changed (no items array)");
        pages = Math.ceil((data.meta?.count ?? 0) / PER_PAGE);
        let beyond = 0;
        for (const item of data.items) {
          const event = item.markup ? sasTeaser(item.markup) : null;
          if (!event) continue;
          if (ctx.isBeyondHorizon(event.start)) beyond++;
          const key = `${event.url}|${event.start.date}`;
          if (seen.has(key) || NOT_EVENTS.test(event.title)) continue;
          seen.add(key);
          listed.push(event);
        }
        if (beyond === data.items.length) break;
      }

      const inWindow = listed.filter((e) => ctx.inWindow(e.start));
      let failures = 0;
      const detailed = await mapLimit(inWindow, 4, async (event): Promise<RawEvent | null> => {
        const base: RawEvent = { ...event, hints: [event.organiser], speakers: speakersFromTitle(event.title) };
        try {
          const d = sasDetails(await get(event.url));
          if (NOT_EVENTS.test(d.type)) return null;
          return {
            ...base,
            start: { date: event.start.date, time: d.time },
            location: d.location,
            description: d.description,
            speakers: [...(base.speakers ?? []), ...honorificNames(d.description)],
            hints: [event.organiser, d.type, d.text.slice(0, 3000)],
          };
        } catch (err) {
          if (++failures <= 3) ctx.log.warn(`details failed for ${event.url}: ${String(err).slice(0, 160)}`);
          return base;
        }
      });
      return detailed.filter((e): e is RawEvent => e !== null);
    });
  },
};
