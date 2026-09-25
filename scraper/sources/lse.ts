/**
 * LSE (lse.ac.uk/events) — the listing is a Contensis app that queries the
 * public Contensis Delivery API from the browser. We call the same API
 * (structured dates, speakers, chairs, format) and page through it.
 *
 * The access token is the site's public, read-only delivery token (sent by
 * every visitor's browser). If it's ever rotated, we fall back to the
 * server-rendered listing, which paginates with ?pageIndex=N.
 */

import type { RawEvent, ScrapeContext, Source } from "../core/types.ts";
import { parseDateTime, parseNaiveLondon } from "../core/dates.ts";
import { HttpError } from "../core/http.ts";
import { absUrl, loadHtml, textOf } from "../core/html.ts";
import { splitNames } from "../core/text.ts";

const SITE = "https://www.lse.ac.uk";
const API = "https://api-lse.cloud.contensis.com/api/delivery/projects/website/entries/search";
const TOKEN = "BA8L4mz1j3YcQ3D37nW3fHiTdaid7cXw4GTlG3l3Nr3J455jJ";
const PAGE_SIZE = 50;

interface Person {
  entryTitle?: string;
}
interface LseEntry {
  entryTitle?: string;
  title?: string;
  subtitle?: string;
  date?: { from?: string; to?: string };
  location?: string;
  speakers?: Person[];
  chair?: Person[];
  moderator?: Person[];
  discussants?: Person[];
  eventType?: Person[];
  format?: Person[];
  metaInformation?: { description?: string };
  metaUICard?: { summary?: string };
  content?: Array<{ type?: string; value?: unknown }>;
  sys?: { uri?: string };
}
interface SearchResponse {
  items: LseEntry[];
  pageCount: number;
  totalCount: number;
}

function names(people: Person[] | undefined): string[] {
  return (people ?? []).map((p) => p.entryTitle ?? "").filter(Boolean);
}

function firstParagraph(content: LseEntry["content"]): string | null {
  for (const block of content ?? []) {
    if (block.type === "_paragraph" && typeof block.value === "string" && block.value.trim()) return block.value;
  }
  return null;
}

function toRaw(entry: LseEntry): RawEvent | null {
  const from = entry.date?.from ? parseNaiveLondon(entry.date.from) : null;
  const uri = entry.sys?.uri;
  if (!from || !uri) return null;
  const labels = [...names(entry.eventType), ...names(entry.format)];
  return {
    title: entry.entryTitle || entry.title || "",
    url: new URL(uri, SITE).toString(),
    start: from,
    end: entry.date?.to ? parseNaiveLondon(entry.date.to) : null,
    location: entry.location ?? null,
    description: entry.metaInformation?.description || entry.metaUICard?.summary || firstParagraph(entry.content),
    speakers: [...names(entry.speakers), ...names(entry.chair), ...names(entry.moderator), ...names(entry.discussants)],
    hints: [entry.metaUICard?.summary ?? "", entry.subtitle ?? "", ...labels],
    // An "Online" or "In-person" format label is more reliable than prose.
    online: labels.some((l) => /^online$/i.test(l)) && !labels.some((l) => /in[\s-]person|hybrid/i.test(l)) ? true : null,
  };
}

async function viaApi(ctx: ScrapeContext): Promise<RawEvent[]> {
  const where = [
    { field: "sys.versionStatus", equalTo: "published" },
    { field: "sys.language", in: ["en-GB"] },
    { field: "displayOnEventListing", equalTo: true },
    { field: "sys.uri", exists: true },
    { field: "sys.contentTypeId", in: ["event"] },
    { field: "date.to", greaterThanOrEqualTo: ctx.horizon.from.toISOString() },
    { field: "date.from", lessThan: ctx.horizon.to.toISOString() },
  ];
  const fields = "entryTitle,title,subtitle,date,location,speakers,chair,moderator,discussants,eventType,format,metaInformation,metaUICard,content,sys.uri";
  const events: RawEvent[] = [];
  for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
    const params = new URLSearchParams({
      where: JSON.stringify(where),
      orderBy: JSON.stringify([{ asc: "date.from" }]),
      fields,
      linkDepth: "1",
      pageIndex: String(pageIndex),
      pageSize: String(PAGE_SIZE),
    });
    const res = await ctx.http.json<SearchResponse>(`${API}?${params}`, {
      headers: { accesstoken: TOKEN, Origin: SITE, Referer: `${SITE}/` },
    });
    for (const entry of res.items ?? []) {
      const raw = toRaw(entry);
      if (raw) events.push(raw);
    }
    if (pageIndex + 1 >= res.pageCount) break;
  }
  return events;
}

/** Fallback: the server-rendered listing (12 per page). */
async function viaHtml(ctx: ScrapeContext): Promise<RawEvent[]> {
  const events: RawEvent[] = [];
  for (let page = 1; page <= 15; page++) {
    const $ = loadHtml(await ctx.http.text(`${SITE}/events/search-events?pageIndex=${page}`));
    const cards = $(".listing-card");
    if (cards.length === 0) break;
    let beyond = 0;
    cards.each((_, el) => {
      const card = $(el);
      const link = card.find(".card__title a").first();
      const when = parseDateTime(textOf(card.find(".card__description")));
      const url = absUrl(link.attr("href"), SITE);
      if (!when || !url) return;
      if (ctx.isBeyondHorizon(when)) beyond++;
      events.push({
        title: textOf(link),
        url,
        start: when,
        location: textOf(card.find(".card__location")),
        speakers: splitNames(textOf(card.find(".card__speakers"))),
      });
    });
    if (beyond === cards.length) break;
  }
  return events;
}

export const lse: Source = {
  id: "lse",
  name: "LSE",
  homepage: `${SITE}/events`,
  // LSE's public events are free and open to all (paid exceptions say so in their pages).
  defaults: { free: true },
  async scrape(ctx) {
    try {
      return await viaApi(ctx);
    } catch (err) {
      if (!(err instanceof HttpError) || ![401, 403].includes(err.status)) throw err;
      ctx.log.warn(`Contensis API rejected the token (${err.status}); falling back to HTML listing`);
      return viaHtml(ctx);
    }
  },
};
