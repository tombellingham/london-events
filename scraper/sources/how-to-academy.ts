/**
 * How To Academy — the events calendar lists everything upcoming on one page
 * in three sections: SINGLE EVENTS (London), ONLINE EVENTS (livestreams) and
 * MULTIPLE DATES (tours). Tour pages list each date as a ticket link whose URL
 * encodes the venue and exact start ("…/london-royal-geographical-society/
 * 2026-10-13-19-30"), so tours become one event per London date. Event pages
 * provide description, speakers and prices. Everything here is ticketed.
 */

import type { RawEvent, ScrapeContext, Source } from "../core/types.ts";
import { formatDate, parseTime } from "../core/dates.ts";
import { absUrl, loadHtml, type CheerioAPI } from "../core/html.ts";
import { clean, speakersFromPhrase, speakersFromTitle, uniqNames } from "../core/text.ts";
import { enrichAll, mapSettled } from "../core/async.ts";

const SITE = "https://howtoacademy.com";
const CALENDAR = `${SITE}/events-calendar/`;

type Section = "single" | "online" | "tour";

function sectionOf(header: string): Section | null {
  const h = header.toUpperCase();
  if (h.includes("SINGLE")) return "single";
  if (h.includes("ONLINE")) return "online";
  if (h.includes("MULTIPLE")) return "tour";
  return null;
}

interface Details {
  description: string | null;
  speakers: string[];
  price: string | null;
}

function pageDetails($: CheerioAPI): Details {
  const article = $("article.single_event_wrapper__content").first();
  const description = [article.children("h2").first().text(), article.children("p").first().text()].map(clean).filter(Boolean).join(" ");
  const speakers = $(".single_event_wrapper__sidebar--bio h3").map((_, h) => clean($(h).text())).get();
  const priceBlock = $(".eventInfo_wrapper").filter((_, el) => /price/i.test($(el).find("h3").first().text())).first();
  const price = clean(priceBlock.find("p").first().text()) || null;
  return { description: description || null, speakers, price };
}

async function tourDates(ctx: ScrapeContext, url: string, title: string): Promise<RawEvent[]> {
  const $ = loadHtml(await ctx.http.text(url));
  const details = pageDetails($);
  const out: RawEvent[] = [];
  $("#tourdates a").each((_, a) => {
    const link = $(a);
    const m = (link.attr("href") ?? "").match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\/?$/);
    if (!m) return;
    const infos = link.find(".event_info h2").map((_, h) => clean($(h).text())).get();
    const venue = infos[0] ?? "";
    // Tour venues read "Venue, City": keep the London dates only.
    if (!/,\s*london\s*$/i.test(venue)) return;
    const subtitle = infos[1] ?? "";
    const priceText = infos[2]?.match(/tickets?\s+from\s+£[\d.]+/i)?.[0] ?? details.price;
    out.push({
      title,
      url,
      start: { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` },
      location: venue,
      description: details.description,
      speakers: uniqNames([...details.speakers, ...speakersFromTitle(title, details.description), ...speakersFromPhrase(subtitle)]),
      priceText,
      online: false,
      hints: [subtitle],
    });
  });
  return out;
}

export const howToAcademy: Source = {
  id: "how-to-academy",
  name: "How To Academy",
  homepage: CALENDAR,
  defaults: { free: false },
  async scrape(ctx) {
    const $ = loadHtml(await ctx.http.text(CALENDAR));
    const singles: RawEvent[] = [];
    const tours: Array<{ url: string; title: string }> = [];

    $("h2.event-type-header").each((_, header) => {
      const section = sectionOf(clean($(header).text()));
      if (!section) return;
      $(header)
        .nextUntil("h2.event-type-header")
        .find("a.calendar_page__months--single")
        .each((_, el) => {
          const card = $(el);
          const url = absUrl(card.attr("href"), SITE);
          const heads = card.find(".event_info h2").map((_, h) => clean($(h).text())).get();
          const title = heads[0];
          if (!url || !title) return;
          if (section === "tour") {
            tours.push({ url, title });
            return;
          }
          // data-date is UTC midnight of the calendar date (the only place the year appears).
          const stamp = Number(card.attr("data-date"));
          if (!stamp) return;
          const d = new Date(stamp * 1000);
          const date = formatDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
          const styled = clean(card.find("h2.margin-top:not(.mobile) .styled").first().text());
          const venue = clean(styled.split(/\b(?:BST|GMT)\b/)[1] ?? "");
          const subtitle = heads[1] ?? "";
          singles.push({
            title,
            url,
            start: { date, time: parseTime(styled) },
            location: section === "online" ? "Online" : venue || null,
            online: section === "online",
            speakers: uniqNames([...speakersFromPhrase(title), ...speakersFromPhrase(subtitle)]),
            hints: [subtitle],
          });
        });
    });
    if (singles.length === 0 && tours.length === 0) throw new Error("No event cards found — calendar markup may have changed");

    const inWindow = singles.filter((e) => ctx.inWindow(e.start));
    const enriched = await enrichAll(ctx, inWindow, 3, async (event) => {
      const details = pageDetails(loadHtml(await ctx.http.text(event.url)));
      return {
        ...event,
        description: details.description,
        speakers: uniqNames([...details.speakers, ...(event.speakers ?? []), ...speakersFromTitle(event.title, details.description)]),
        priceText: details.price,
      };
    }, (e) => e.url);

    const tourEvents = await mapSettled(tours, 3, (t) => tourDates(ctx, t.url, t.title), (t, err) => ctx.log.warn(`tour page failed ${t.url}: ${String(err)}`));
    return [...enriched, ...tourEvents.flat()];
  },
};
