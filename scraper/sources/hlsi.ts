/**
 * Highgate Literary & Scientific Institution — WordPress + The Events
 * Calendar, whose REST API (/wp-json/tribe/events/v1/events) returns
 * structured events with London-local start times, venues and categories.
 *
 * Most of the calendar is weekly courses, classes and fitness sessions; only
 * talks, lectures and debates are kept (by category). The site is behind
 * SiteGround's bot check, which a real browser passes on its own, so
 * fetchJson falls back to the browser when it appears.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseNaiveLondon } from "../core/dates.ts";
import { clean, cleanName, htmlToLines, htmlToText, labelled, looksLikeName, speakersFromTitle, uniqNames } from "../core/text.ts";
import { fetchJson, laterPage } from "../core/fetch.ts";

const SITE = "https://hlsi.org.uk";
const ADDRESS = "Highgate Literary & Scientific Institution, 11 South Grove, N6 6BS";

interface TribeEvent {
  title: string;
  url: string;
  description?: string;
  excerpt?: string;
  start_date: string;
  end_date?: string;
  all_day?: boolean;
  cost?: string;
  venue?: { venue?: string; address?: string; city?: string; zip?: string } | unknown[];
  categories?: Array<{ name: string; slug: string }>;
  tags?: Array<{ name: string }>;
}

interface TribeResponse {
  events: TribeEvent[];
  total_pages?: number;
  next_rest_url?: string;
}

const TALK = /lecture|talk|debate|opera circle|science|conversation|special event/i;
const NOT_TALK = /course|workshop|class|fitness|pilates|tai chi|walk|concert|film|cinema|exhibition|fair|library|choir|yoga|drawing|painting/i;

function decode(text: string): string {
  return clean(htmlToText(text));
}

/** "Speaker: Nicola Moorby, Curator, British Art…" → "Nicola Moorby". */
function speakersFrom(description: string, title: string): string[] {
  const lines = htmlToLines(description);
  const names: string[] = [];
  const line = labelled(lines, /^speakers?\s*:?/i);
  if (line) {
    for (const part of line.split(/\s*(?:;|\band\b|&)\s*/)) {
      const name = cleanName(part.split(",")[0]);
      if (looksLikeName(name)) names.push(name);
    }
  }
  return uniqNames([...names, ...speakersFromTitle(title)]);
}

function isTalk(e: TribeEvent): boolean {
  const cats = (e.categories ?? []).map((c) => decode(c.name));
  if (cats.some((c) => NOT_TALK.test(c))) return false;
  if (cats.some((c) => TALK.test(c) && !/special event/i.test(c))) return true;
  // "Special Events" is a grab bag: keep it only when it reads like a talk.
  return cats.some((c) => /special event/i.test(c)) && /\b(?:talk|lecture|in conversation|speaker|discussion|debate)\b/i.test(`${e.title} ${e.description ?? ""}`);
}

export const hlsi: Source = {
  id: "hlsi",
  name: "Highgate Literary & Scientific Institution",
  homepage: `${SITE}/events/`,
  defaults: { location: ADDRESS },
  async scrape(ctx) {
    const events: RawEvent[] = [];
    for (let page = 1; page <= 25; page++) {
      const params = new URLSearchParams({
        per_page: "50",
        page: String(page),
        start_date: `${ctx.horizon.fromDate} 00:00:00`,
        end_date: `${ctx.horizon.toDate} 00:00:00`,
        status: "publish",
      });
      const data = await laterPage(ctx, page, 1, () => fetchJson<TribeResponse>(ctx, `${SITE}/wp-json/tribe/events/v1/events?${params}`));
      if (data === null) break;
      for (const e of data.events ?? []) {
        if (!isTalk(e)) continue;
        const start = parseNaiveLondon(e.start_date);
        if (!start) continue;
        const title = decode(e.title);
        const description = e.description ?? "";
        const venue = Array.isArray(e.venue) ? undefined : e.venue;
        const room = decode(venue?.venue ?? "");
        const online = /^online$/i.test(room);
        events.push({
          title,
          url: e.url,
          start: e.all_day ? { date: start.date, time: null } : start,
          end: e.end_date ? parseNaiveLondon(e.end_date) : null,
          location: online ? "Online" : room && !/^hlsi$/i.test(room) ? `${room}, ${ADDRESS}` : ADDRESS,
          online: online ? true : null,
          description,
          // Prices live in the prose ("Members: Free … Non-Members: £10").
          priceText: decode(e.cost ?? "") || htmlToLines(description).find((l) => /£\s?\d/.test(l)) || null,
          speakers: speakersFrom(description, title),
          hints: [(e.categories ?? []).map((c) => decode(c.name)).join(", ")],
        });
      }
      if (!data.next_rest_url || page >= (data.total_pages ?? page)) break;
    }
    return events;
  },
};
