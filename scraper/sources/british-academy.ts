/**
 * The British Academy — events come from the listing API behind its /events/
 * page, /api/v2/filter/events/ (Wagtail): title, start/end date, full
 * location, city, a free flag and event types for each event page (series
 * pages are skipped). Each event page then gives the start time
 * ("Tue 20 Oct 2026, 18:30 - 19:45"), Venue / Price / Facilities fields, a
 * summary and a "Speakers" section of <h3> names.
 *
 * Cloudflare guards the site unevenly: /events/ and the API are often
 * challenged even for a real browser, while the homepage isn't — and the API
 * and event pages can then be fetched from inside the homepage. If the API
 * isn't readable, the rendered /events/ list is used instead.
 *
 * Many lectures are held around the UK; normalize keeps those only when
 * they're streamed ("Online and in person" in Facilities).
 */

import type { LondonDateTime, RawEvent, ScrapeContext, Source } from "../core/types.ts";
import { loadHtml, type CheerioAPI } from "../core/html.ts";
import { clean, cleanName, looksLikeName, speakersFromTitle, uniqNames } from "../core/text.ts";
import { parseDate, parseNaiveLondon, parseTime } from "../core/dates.ts";
import { mapLimit } from "../core/async.ts";
import { preferBrowser } from "../core/fetch.ts";

const SITE = "https://www.thebritishacademy.ac.uk";

// Plain requests from CI always meet a bot wall here.
preferBrowser("www.thebritishacademy.ac.uk");

type Listed = RawEvent & { start: LondonDateTime };

interface ApiEvent {
  title?: string;
  meta?: { type?: string; html_url?: string; search_description?: string };
  start_date?: string;
  end_date?: string;
  location?: string;
  city?: string;
  free?: boolean;
  types?: Array<{ name?: string }>;
  teaser_summary?: string;
}

interface ApiPage {
  count?: number;
  next?: string | null;
  results?: ApiEvent[];
}

/** One API result → event (null for series pages and anything incomplete). */
export function baApiEvent(item: ApiEvent): Listed | null {
  if (!/(?:^|\.)EventPage$/.test(item.meta?.type ?? "event.EventPage")) return null;
  const url = item.meta?.html_url;
  const start = parseNaiveLondon(item.start_date ?? "");
  const title = clean(item.title);
  if (!url || !start || !title) return null;
  const end = parseNaiveLondon(item.end_date ?? "");
  return {
    title,
    url,
    start: { date: start.date, time: null },
    end,
    location: clean(item.location) || clean(item.city) || null,
    free: typeof item.free === "boolean" ? item.free : undefined,
    description: clean(item.teaser_summary) || clean(item.meta?.search_description) || null,
    speakers: speakersFromTitle(title),
    hints: [(item.types ?? []).map((t) => t.name).join(", ")],
  };
}

function field($: CheerioAPI, label: RegExp): string {
  let value = "";
  $("dl dt").each((_, dt) => {
    if (!value && label.test(clean($(dt).text()))) value = clean($(dt).next("dd").text()).replace(/,\s*$/, "");
  });
  return value;
}

function speakers($: CheerioAPI): string[] {
  const names: string[] = [];
  const heading = $("h2").filter((_, h) => /^speakers?$/i.test(clean($(h).text()))).first();
  // Speaker names are the <h3>s between "Speakers" and the next <h2>.
  for (let el = heading.next(); el.length && !el.is("h2"); el = el.next()) {
    if (!el.is("h3")) continue;
    const name = cleanName(el.text());
    if (looksLikeName(name)) names.push(name);
  }
  return names;
}

/** Event page → time, venue, price, format, speakers. */
export function baDetails(event: Listed, html: string): RawEvent {
  const $ = loadHtml(html);
  const whenLine = clean($("h1").first().nextAll("p.h6").first().text());
  const time = parseTime(whenLine.split(",").slice(1).join(","));
  const venue = field($, /^venue$/i);
  const price = field($, /^price$/i);
  const facilities = field($, /^facilities$/i);
  const online = /\bonline only\b/i.test(facilities) || /^online$/i.test(venue) ? true : null;
  return {
    ...event,
    start: { date: event.start.date, time },
    location: online ? "Online" : venue || event.location,
    online,
    priceText: price || null,
    description: clean($('meta[name="description"]').attr("content")) || event.description,
    speakers: uniqNames([...speakers($), ...(event.speakers ?? [])]),
    // "Online and in person" / "live streamed" keeps streamed lectures outside London.
    hints: [facilities, clean($(".wysiwyg").text()).slice(0, 3000), ...(event.hints ?? [])],
  };
}

/** The rendered /events/ list (client-side, so browser only): the fallback. */
async function listingFromPage(ctx: ScrapeContext): Promise<Listed[]> {
  const $ = loadHtml(await ctx.browser.html(`${SITE}/events/`, { waitFor: "#filtered-list h3 a", settleMs: 1500 }));
  const listed: Listed[] = [];
  $("#filtered-list h3 a").each((_, a) => {
    const link = $(a);
    const card = link.closest(".flex-col");
    const label = clean(card.find("p.uppercase").first().text());
    const [when, ...place] = clean(card.find("p.text-cta").first().text()).split(",");
    const date = parseDate(when ?? "");
    const url = link.attr("href");
    if (!url || !label || !date) return; // unlabelled cards are event series
    const endText = (when ?? "").split(/\s+-\s+/)[1];
    const end = endText ? parseDate(endText) : null;
    const title = clean(link.text());
    listed.push({
      title,
      url: new URL(url, SITE).toString(),
      start: { date, time: null },
      end: end ? { date: end, time: null } : null,
      location: clean(place.join(",")) || null,
      free: /\bfree\b/i.test(label) ? true : undefined,
      speakers: speakersFromTitle(title),
      hints: [label],
    });
  });
  return listed;
}

export const britishAcademy: Source = {
  id: "british-academy",
  name: "The British Academy",
  homepage: `${SITE}/events/`,
  defaults: { free: true, location: "The British Academy, 10-11 Carlton House Terrace, SW1Y 5AH" },
  timeoutMs: 360_000,
  async scrape(ctx) {
    let viaApi: RawEvent[] | null = null;
    try {
      viaApi = await ctx.browser.inPage(`${SITE}/`, async (get) => {
        const listed: Listed[] = [];
        for (let page = 1; page <= 6; page++) {
          const data = JSON.parse(await get(`/api/v2/filter/events/?fields=*&page=${page}&results=50`, { headers: { Accept: "application/json" } })) as ApiPage;
          if (!Array.isArray(data.results)) throw new Error("listing API shape changed (no results array)");
          const batch = data.results.map(baApiEvent).filter((e): e is Listed => e !== null);
          listed.push(...batch);
          if (!data.next || batch.every((e) => ctx.isBeyondHorizon(e.start))) break;
        }
        // Event pages from the same (already cleared) page, a few at a time.
        const inWindow = listed.filter((e) => ctx.inWindow(e.start));
        let failures = 0;
        return mapLimit(inWindow, 3, async (event) => {
          try {
            return baDetails(event, await get(event.url));
          } catch (err) {
            if (++failures <= 3) ctx.log.warn(`details failed for ${event.url}: ${String(err).slice(0, 160)}`);
            return event;
          }
        });
      });
    } catch (err) {
      ctx.log.warn(`listing API unavailable (${String(err).slice(0, 160)}); reading the events page instead`);
    }
    if (viaApi) return viaApi;

    const listed = await listingFromPage(ctx);
    if (!listed.length) throw new Error("no events found on the events page (layout change or blocked)");
    const inWindow = listed.filter((e) => ctx.inWindow(e.start));
    return mapLimit(inWindow, 2, async (event) => {
      try {
        return baDetails(event, await ctx.browser.html(event.url, { waitFor: "dl dt" }));
      } catch {
        return event;
      }
    });
  },
};
