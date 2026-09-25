/**
 * Gresham College — the What's On listing is driven by a pre-built JSON file
 * (all upcoming lectures, with London-local start times and speaker refs).
 * Venue, format and description come from each lecture's page.
 *
 * The JSON file 403s some cloud IPs (not GitHub's); if that happens we read
 * it through a real browser session on the site instead.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseNaiveLondon, parseTime, toLondonDateTime } from "../core/dates.ts";
import { HttpError } from "../core/http.ts";
import { absUrl, loadHtml } from "../core/html.ts";
import { clean, looksLikeName } from "../core/text.ts";
import { enrichAll } from "../core/async.ts";

const SITE = "https://www.gresham.ac.uk";

const londonDateOf = (d: Date) => toLondonDateTime(d).date;
const FEED = `${SITE}/sites/default/files/attachments/whatson.json`;

interface GreshamEvent {
  title: string;
  link: string;
  calculated_start_date: string;
  hiddenNodeRefs?: Array<{ label?: string }>;
  vocabOne?: Array<{ label?: string }>;
}

async function loadFeed(ctx: Parameters<Source["scrape"]>[0]): Promise<GreshamEvent[]> {
  let feed: { events?: GreshamEvent[] };
  try {
    feed = await ctx.http.json(FEED);
  } catch (err) {
    if (!(err instanceof HttpError) || err.status !== 403) throw err;
    ctx.log.warn("whatson.json returned 403; reading it through a browser session");
    const [text] = await ctx.browser.fetchFromPage(`${SITE}/whats-on`, [FEED]);
    feed = JSON.parse(text);
  }
  if (!Array.isArray(feed?.events)) throw new Error("Gresham feed shape changed: no events array");
  return feed.events;
}

export const gresham: Source = {
  id: "gresham",
  name: "Gresham College",
  homepage: `${SITE}/whats-on`,
  // Gresham lectures are free to attend and to watch online.
  defaults: { free: true },
  async scrape(ctx) {
    const events: RawEvent[] = [];
    for (const e of await loadFeed(ctx)) {
      // calculated_start_date is UTC ("2026-09-28 17:00:00" = 18:00 BST), despite having no offset.
      const naive = parseNaiveLondon(e.calculated_start_date ?? "");
      const start = naive ? new Date(`${naive.date}T${naive.time ?? "00:00"}:00Z`) : null;
      const url = absUrl(e.link, SITE);
      if (!start || !url || ctx.isBeforeHorizon(start) || ctx.isBeyondHorizon(start)) continue;
      events.push({
        title: e.title,
        url,
        start,
        speakers: (e.hiddenNodeRefs ?? []).map((r) => clean(r.label)).filter(looksLikeName),
        hints: (e.vocabOne ?? []).map((v) => v.label ?? ""),
      });
    }

    return enrichAll(ctx, events, 3, async (event) => {
      const $ = loadHtml(await ctx.http.text(event.url));
      const info = (label: string): string => {
        const p = $(".sidebar__information p").filter((_, el) => clean($(el).find("span").first().text()).replace(/:$/, "").toLowerCase() === label).first();
        return clean(p.text().replace(/^[^:]*:/, ""));
      };
      const venue = info("venue");
      // The page's "Time:" is the authoritative London start time.
      const time = parseTime(info("time"));
      const area = info("location");
      const register = clean($(".sidebar__register, [class*=register]").text());
      const inPerson = /attend in person/i.test(register) || Boolean(venue && !/online/i.test(venue));
      const description = $(".m-entity__body").first().find("p").slice(0, 3).map((_, p) => clean($(p).text())).get().join(" ");
      return {
        ...event,
        start: time ? { date: londonDateOf(event.start as Date), time } : event.start,
        location: venue ? [venue, area].filter(Boolean).join(", ") : inPerson ? null : "Online",
        description: description || null,
        online: inPerson ? false : /watch online/i.test(register) ? true : null,
        hints: [...(event.hints ?? []), info("type")],
      };
    }, (e) => e.url);
  },
};
