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

import type { LondonDateTime, RawEvent, Source } from "../core/types.ts";
import { loadHtml, type CheerioAPI } from "../core/html.ts";
import { clean, cleanName, looksLikeName, speakersFromTitle, uniqNames } from "../core/text.ts";
import { parseDate, parseTime } from "../core/dates.ts";
import { enrichAll } from "../core/async.ts";
import { fetchHtml } from "../core/fetch.ts";

const SITE = "https://www.thebritishacademy.ac.uk";

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

export const britishAcademy: Source = {
  id: "british-academy",
  name: "The British Academy",
  homepage: `${SITE}/events/`,
  defaults: { free: true, location: "The British Academy, 10-11 Carlton House Terrace, SW1Y 5AH" },
  async scrape(ctx) {
    // Rendered client-side: plain HTML has an empty list, so go straight to the browser.
    const $ = loadHtml(await ctx.browser.html(`${SITE}/events/`, { waitFor: "#filtered-list h3 a", settleMs: 1500 }));
    const listed: Listed[] = [];
    $("#filtered-list h3 a").each((_, a) => {
      const link = $(a);
      const card = link.closest(".flex-col");
      const label = clean(card.find("p.uppercase").first().text());
      const url = link.attr("href");
      const [when, ...placeParts] = clean(card.find("p.text-cta").first().text()).split(",");
      if (!url || !label) return; // unlabelled cards are event series, not events
      const date = parseDate(when);
      if (!date) return;
      const endText = when.split(/\s+-\s+/)[1];
      const end = endText ? parseDate(endText) : null;
      const title = clean(link.text());
      listed.push({
        title,
        url: new URL(url, SITE).toString(),
        start: { date, time: null },
        end: end ? { date: end, time: null } : null,
        location: clean(placeParts.join(",")) || null,
        free: /\bfree\b/i.test(label) ? true : undefined,
        speakers: speakersFromTitle(title),
        hints: [label],
      });
    });
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
