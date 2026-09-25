/**
 * Geological Society — the events page (Umbraco) loads results by POSTing
 * its search form (with ASP.NET anti-forgery token + cookie) and pages with
 * `page=N`. Listing cards have date badges and truncated titles, so each
 * event page supplies the full title, start time, venue, speakers and fees.
 * Regional-group events elsewhere and online-only events are dropped.
 */

import type { RawEvent, ScrapeContext, Source } from "../core/types.ts";
import { parseDate, parseTime } from "../core/dates.ts";
import { absUrl, loadHtml } from "../core/html.ts";
import { clean, looksLikeName, uniqNames } from "../core/text.ts";
import { enrichAll } from "../core/async.ts";

const SITE = "https://www.geolsoc.org.uk";

interface Session {
  cookie: string;
  form: Record<string, string>;
}

async function openSession(ctx: ScrapeContext): Promise<Session> {
  const res = await ctx.http.request(`${SITE}/events/`, { noCache: true });
  const $ = loadHtml(res.text);
  const form = $('form[action="/events"]').first();
  const token = form.find('input[name="__RequestVerificationToken"]').attr("value") ?? $('input[name="__RequestVerificationToken"]').first().attr("value");
  const ufprt = form.find('input[name="ufprt"]').attr("value") ?? $('input[name="ufprt"]').first().attr("value");
  if (!token || !ufprt) throw new Error("Events search form tokens not found — page structure changed");
  const setCookies = res.headers instanceof Headers ? res.headers.getSetCookie() : [];
  return {
    cookie: setCookies.map((c) => c.split(";")[0]).join("; "),
    form: {
      items: form.find('input[name="items"]').attr("value") ?? "9",
      ExcludedIds: "",
      ParentIds: form.find('input[name="ParentIds"]').attr("value") ?? "1269",
      sortby: "Upcoming",
      categories: "",
      q: "",
      __RequestVerificationToken: token,
      ufprt,
    },
  };
}

export const geologicalSociety: Source = {
  id: "geological-society",
  name: "Geological Society",
  homepage: `${SITE}/events/`,
  defaults: { location: "Geological Society, Burlington House, Piccadilly" },
  async scrape(ctx) {
    const session = await openSession(ctx);
    const listing: RawEvent[] = [];
    for (let page = 1; page <= 20; page++) {
      const html = await ctx.http.text(`${SITE}/events/`, {
        form: { ...session.form, page },
        headers: { Cookie: session.cookie, "X-Requested-With": "XMLHttpRequest", Referer: `${SITE}/events/` },
        noCache: true,
      });
      const $ = loadHtml(html);
      const cards = $("a.card__event");
      if (cards.length === 0) break;
      let beyond = 0;
      cards.each((_, el) => {
        const card = $(el);
        const url = absUrl(card.attr("href"), SITE);
        const badge = card.find(".card__event--badge").first().text();
        const date = parseDate(clean(badge).replace(/^(\w+)\s+(\d+)\s+(\d{4}).*/, "$2 $1 $3"));
        if (!url || !date) return;
        if (ctx.isBeyondHorizon(date)) beyond++;
        const ps = card.find(".card__event--body p").map((_, p) => clean($(p).text())).get();
        listing.push({ title: clean(card.find(".card-title").text()), url, start: { date, time: null }, location: ps[0] ?? null, hints: ps.slice(1) });
      });
      const lastPage = Math.max(0, ...$(".js-pagechange").map((_, b) => Number($(b).attr("data-target-page"))).get());
      if (beyond === cards.length || page >= lastPage) break;
    }

    const inWindow = listing.filter((e) => ctx.inWindow(e.start));
    return enrichAll(ctx, inWindow, 3, async (event) => {
      const $ = loadHtml(await ctx.http.text(event.url));
      const main = $("main").first();
      const title = clean(main.find("h1").first().text()) || event.title;
      const lines = main.text().split("\n").map(clean).filter(Boolean);
      const timeLine = lines.find((l) => /^\d{1,2}[:.]\d{2}\s*[-–]\s*\d{1,2}[:.]\d{2}$/.test(l)) ?? lines.find((l) => /^\d{1,2}[:.]\d{2}$/.test(l));
      const overview = $("#overview-pane p").map((_, p) => clean($(p).text())).get().filter((t) => t.length > 60);
      // Speakers tab: names are headings ("Chair - Bas Spaargaren") or lead paragraphs ("Roger Hoare, Deputy Director…").
      const pane = $("#speakers-pane");
      const candidates = [
        ...pane.find("h2, h3, h4").map((_, h) => clean($(h).text()).replace(/^(?:chair|chaired by|speaker|keynote|host)\s*[-–:]\s*/i, "")).get(),
        ...pane.find("p").map((_, p) => clean($(p).text())).get().filter((t) => t.length < 160).map((t) => t.split(",")[0]),
      ];
      const speakers = uniqNames(candidates.filter(looksLikeName));
      const fees = clean($("#fees-pane").first().text());
      return {
        ...event,
        title,
        start: { date: (event.start as { date: string }).date, time: timeLine ? parseTime(timeLine) : null },
        description: overview.slice(0, 2).join(" ") || null,
        speakers,
        priceText: fees ? fees.slice(0, 200) : null,
        hints: [...(event.hints ?? []), overview.join(" ").slice(0, 2000)],
      };
    }, (e) => e.url);
  },
};
