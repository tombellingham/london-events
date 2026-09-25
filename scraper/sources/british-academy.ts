/**
 * The British Academy — /events/ is a Vue list filled from
 * /api/v2/filter/events/ (12 per page, soonest first), so it's read in a
 * browser. Cards give a type + "Free" label ("Lecture Free"), title, and
 * "6 Oct 2026, Coventry" / "8 - 9 Oct 2026, Edinburgh". Many lectures are
 * held around the UK; those are kept only when they're streamed (the usual
 * London rule in normalize), which needs each event page: time
 * ("Tue 20 Oct 2026, 18:30 - 19:45"), Venue / Price / Facilities fields and
 * a "Speakers" section of <h3> names.
 *
 * Event series pages ("Searching for wellness, 20 Sep - 26 Nov") are skipped.
 */

import type { LondonDateTime, RawEvent, ScrapeContext, Source } from "../core/types.ts";
import { loadHtml, type CheerioAPI } from "../core/html.ts";
import { clean, cleanName, looksLikeName, speakersFromTitle, uniqNames } from "../core/text.ts";
import { parseDate, parseTime } from "../core/dates.ts";
import { enrichAll } from "../core/async.ts";
import { fetchHtml, preferBrowser } from "../core/fetch.ts";

const SITE = "https://www.thebritishacademy.ac.uk";

// Plain requests from CI always meet a bot wall here.
preferBrowser("www.thebritishacademy.ac.uk");

type Listed = RawEvent & { start: LondonDateTime };

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
  if (!heading.length) return names;
  // Speaker names are the <h3>s between "Speakers" and the next <h2>.
  for (let el = heading.next(); el.length && !el.is("h2"); el = el.next()) {
    if (!el.is("h3")) continue;
    const name = cleanName(el.text());
    if (looksLikeName(name)) names.push(name);
  }
  return names;
}

/** The rendered /events/ list (Vue, so browser only). */
async function listingFromPage(ctx: ScrapeContext): Promise<Listed[]> {
  const $ = loadHtml(await ctx.browser.html(`${SITE}/events/`, { waitFor: "#filtered-list h3 a", settleMs: 1500 }));
  const listed: Listed[] = [];
  $("#filtered-list h3 a").each((_, a) => {
    const link = $(a);
    const card = link.closest(".flex-col");
    const event = listingEntry({
      url: link.attr("href") ?? "",
      title: clean(link.text()),
      label: clean(card.find("p.uppercase").first().text()),
      when: clean(card.find("p.text-cta").first().text()),
    });
    if (event) listed.push(event);
  });
  return listed;
}

type Json = Record<string, unknown>;

/** Best-effort read of one /api/v2/filter/events/ item (a Wagtail page with display fields). */
function apiEntry(item: Json): Listed | null {
  const str = (v: unknown) => (typeof v === "string" ? clean(v) : "");
  const meta = (item.meta ?? {}) as Json;
  const url = str(item.url) || str(item.full_url) || str(meta.html_url) || str(item.link);
  const title = str(item.title);
  const dateKey = Object.keys(item).find((k) => /date|when|time/i.test(k) && typeof item[k] === "string" && parseDate(item[k] as string));
  const placeKey = Object.keys(item).find((k) => /location|city|venue|place/i.test(k) && typeof item[k] === "string");
  const labelParts = Object.keys(item)
    .filter((k) => /type|label|category|free|price/i.test(k))
    .map((k) => (typeof item[k] === "boolean" ? (item[k] ? "Free" : "") : str(item[k])));
  const when = [dateKey ? str(item[dateKey]) : "", placeKey ? str(item[placeKey]) : ""].filter(Boolean).join(", ");
  return listingEntry({ url, title, label: labelParts.join(" ") || "Event", when });
}

async function listingFromApi(ctx: ScrapeContext): Promise<Listed[]> {
  return ctx.browser.inPage(`${SITE}/`, async (get) => {
    const listed: Listed[] = [];
    for (let page = 1; page <= 5; page++) {
      const data = JSON.parse(await get(`/api/v2/filter/events/?fields=*&page=${page}&results=12`)) as Json;
      const items = (Array.isArray(data.items) ? data.items : Array.isArray(data.results) ? data.results : []) as Json[];
      if (!items.length) break;
      const before = listed.length;
      for (const item of items) {
        const event = apiEntry(item);
        if (event) listed.push(event);
      }
      if (listed.length === before) throw new Error(`listing API items not understood: ${JSON.stringify(items[0]).slice(0, 200)}`);
      if (listed.slice(before).every((e) => ctx.isBeyondHorizon(e.start))) break;
    }
    return listed;
  });
}

/** Card fields → event. Unlabelled cards are event series ("Searching for wellness, 20 Sep - 26 Nov"). */
function listingEntry(card: { url: string; title: string; label: string; when: string }): Listed | null {
  if (!card.url || !card.title || !card.label) return null;
  const [when, ...placeParts] = card.when.split(",");
  const date = parseDate(when ?? "");
  if (!date) return null;
  const endText = (when ?? "").split(/\s+-\s+/)[1];
  const end = endText ? parseDate(endText) : null;
  return {
    title: card.title,
    url: new URL(card.url, SITE).toString(),
    start: { date, time: null },
    end: end ? { date: end, time: null } : null,
    location: clean(placeParts.join(",")) || null,
    free: /\bfree\b/i.test(card.label) ? true : undefined,
    speakers: speakersFromTitle(card.title),
    hints: [card.label],
  };
}

export const britishAcademy: Source = {
  id: "british-academy",
  name: "The British Academy",
  homepage: `${SITE}/events/`,
  defaults: { free: true, location: "The British Academy, 10-11 Carlton House Terrace, SW1Y 5AH" },
  async scrape(ctx) {
    let listed: Listed[];
    try {
      listed = await listingFromPage(ctx);
    } catch (err) {
      // /events/ is intermittently challenged even for a real browser; the
      // homepage usually isn't, and the listing's own API can be read from it.
      ctx.log.warn(`events page unavailable (${String(err).slice(0, 120)}); trying the listing API`);
      listed = await listingFromApi(ctx);
    }
    if (!listed.length) throw new Error("no events found on the listing (layout change or blocked)");

    const inWindow = listed.filter((e) => ctx.inWindow(e.start));
    if (inWindow.length === listed.length) ctx.log.warn("all listed events fall inside the horizon; later ones may be on the next API page");

    return enrichAll<Listed>(
      ctx,
      inWindow,
      2,
      async (event) => {
        const page = loadHtml(await fetchHtml(ctx, event.url, { browser: { waitFor: "dl dt" } }));
        const whenLine = clean(page("h1").first().nextAll("p.h6").first().text());
        const time = parseTime(whenLine.split(",").slice(1).join(","));
        const venue = field(page, /^venue$/i);
        const price = field(page, /^price$/i);
        const facilities = field(page, /^facilities$/i);
        const description = page('meta[name="description"]').attr("content") ?? null;
        const online = /\bonline only\b/i.test(facilities) || /^online$/i.test(venue) ? true : null;
        return {
          ...event,
          start: { date: event.start.date, time },
          location: online ? "Online" : venue || event.location,
          online,
          priceText: price || null,
          description: clean(description) || null,
          speakers: uniqNames([...speakers(page), ...(event.speakers ?? [])]),
          // "Online and in person" / "live streamed" keeps streamed lectures outside London.
          hints: [facilities, clean(page(".wysiwyg").text()).slice(0, 3000)],
        };
      },
      (e) => e.url,
    );
  },
};
