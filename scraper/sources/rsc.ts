/**
 * Royal Society of Chemistry — the "UK and Ireland events" listing
 * (?Page=N, 20 per page) covers RSC and partner events nationwide; only
 * London ones are kept, minus training courses and site visits. Cards give
 * a (sometimes truncated) title, a date or date range and a city; each event
 * page carries schema.org Event JSON-LD with the full title, naive London
 * start time, venue and attendance mode.
 *
 * rsc.org is behind Cloudflare, which challenges bursts of requests, so the
 * host is throttled and blocked pages are retried in a browser.
 */

import type { LondonDateTime, RawEvent, Source } from "../core/types.ts";

/** Listing entries always carry a London date (time filled in from the event page). */
type Listed = RawEvent & { start: LondonDateTime };
import { absUrl, hasType, jsonLdNodes, loadHtml } from "../core/html.ts";
import { clean, honorificNames, speakersFromTitle } from "../core/text.ts";
import { parseDate, parseNaiveLondon } from "../core/dates.ts";
import { enrichAll } from "../core/async.ts";
import { configureHost } from "../core/http.ts";
import { fetchHtml, laterPage } from "../core/fetch.ts";

const SITE = "https://www.rsc.org";
const LISTING = `${SITE}/events/find-an-event/uk-and-ireland-events`;
const NOT_TALKS = /\b(?:short course|course|training|workshop|site visit|tour|competition|olympiad|exam|careers? fair|practical)\b/i;

configureHost("www.rsc.org", { concurrency: 1, intervalMs: 3000 });

type Json = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? clean(v) : "";
}

export const rsc: Source = {
  id: "rsc",
  name: "Royal Society of Chemistry",
  homepage: LISTING,
  timeoutMs: 480_000,
  async scrape(ctx) {
    const listed: Listed[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= 12; page++) {
      const html = await laterPage(ctx, page, 1, () => fetchHtml(ctx, page > 1 ? `${LISTING}?Page=${page}` : LISTING, { browser: { waitFor: ".card--link" } }));
      if (html === null) break;
      const $ = loadHtml(html);
      const cards = $(".card.card--link");
      if (!cards.length) break;
      let last = 0;
      let total = 0;
      cards.each((_, el) => {
        const card = $(el);
        last = Math.max(last, Number(card.attr("data-list-rank") ?? 0));
        total = Number(card.attr("data-list-count") ?? total);
        const link = card.find(".card__title a").first();
        const url = absUrl(link.attr("href"), SITE);
        const location = clean(card.find(".card__location").text());
        const subtitle = clean(card.find(".card__company").text());
        const title = clean(link.text());
        if (!url || seen.has(url) || !/london/i.test(location)) return;
        if (NOT_TALKS.test(`${title} ${subtitle}`)) return;
        const date = parseDate(clean(card.find(".card__date").text()));
        if (!date) return;
        seen.add(url);
        listed.push({ title, url, start: { date, time: null }, location, description: subtitle || null });
      });
      if (!last || !total || last >= total) break;
    }

    const inWindow = listed.filter((e) => ctx.inWindow(e.start));
    return enrichAll(
      ctx,
      inWindow,
      1,
      async (event) => {
        const $ = loadHtml(await fetchHtml(ctx, event.url));
        const node = jsonLdNodes($).find((n) => hasType(n, /Event/)) as Json | undefined;
        const start = parseNaiveLondon(str(node?.startDate)) ?? event.start;
        const places = ([] as unknown[]).concat(node?.location ?? []) as Json[];
        const place = places.find((p) => hasType(p, /Place/));
        const address = clean($(".eventDetails__venueAddress").first().text()) || str((place?.address as Json | undefined)?.streetAddress);
        const mode = str(node?.eventAttendanceMode);
        const online = /OnlineEventAttendanceMode/.test(mode) ? true : /Mixed|Offline/.test(mode) ? false : null;
        const synopsis = $(".courseDetails .wysiwyg p")
          .map((_, p) => clean($(p).text()))
          .get()
          .filter((t) => t.length > 40);
        const description = synopsis.join(" ") || event.description;
        const title = str(node?.name) || event.title.replace(/\.\.\.$/, "");
        return {
          ...event,
          title,
          start: start.date === event.start.date ? start : event.start,
          location: online ? "Online" : address || event.location,
          online,
          description,
          speakers: speakersFromTitle(title, description).concat(honorificNames(description)),
          hints: [clean($(".eventDetails, .courseDetails").text()).slice(0, 3000)],
        };
      },
      (e) => e.url,
    );
  },
};
