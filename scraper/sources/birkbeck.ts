/**
 * Birkbeck — /events lists everything (12 per page, ?page=N). Cards give the
 * start (datetime digits are London wall-clock despite a +00:00 suffix), the
 * venue ("Online", "Hybrid", "External", a building) and booking note; each
 * event page supplies the description and the real venue for "External"
 * events. Student induction/skills sessions and multi-week runs are skipped.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseDate, parseIsoAsLondonWallClock, parseTime } from "../core/dates.ts";
import { absUrl, loadHtml } from "../core/html.ts";
import { clean, honorificNames, htmlToLines, labelled, speakersFromTitle, uniqNames } from "../core/text.ts";
import { enrichAll } from "../core/async.ts";
import { laterPage } from "../core/fetch.ts";

const SITE = "https://www.bbk.ac.uk";
const INTERNAL = /^(?:get ready|virtual enrolment|enrolment|induction|welcome|uni connect|linking london|study skills|open (?:day|evening)|applicant|offer holder|graduation|freshers|library tour|ilc open session|academic english|presenting with confidence|orientation|post-arrival|campus tours?|disabled students|meet the)\b|\b(?:study skills|enrolment support|drop-in session|offer holders?|short course(?: booking)?|course booking|workshop series|cpd spotlight|careers? (?:fair|clinic|workshop)|employability|taster (?:course|session|day)|a career for you|fast stream|for (?:new|prospective|international|current) (?:students|undergraduates|postgraduates|applicants)|students[’']? allowance|information session)\b/i;

export const birkbeck: Source = {
  id: "birkbeck",
  name: "Birkbeck",
  homepage: `${SITE}/events`,
  defaults: { free: true },
  include: (e) => !INTERNAL.test(e.title),
  async scrape(ctx) {
    const events: RawEvent[] = [];
    for (let page = 1; page <= 25; page++) {
      const html = await laterPage(ctx, page, 1, () => ctx.http.text(`${SITE}/events${page > 1 ? `?page=${page}` : ""}`));
      if (html === null) break;
      const $ = loadHtml(html);
      const cards = $("a.card");
      if (cards.length === 0) break;
      let beyond = 0;
      cards.each((_, el) => {
        const card = $(el);
        const url = absUrl(card.attr("href"), `${SITE}/`);
        const title = clean(card.find(".card__title").text());
        const body = card.find(".card__body");
        const stamps = body.find("time[datetime]").map((_, t) => $(t).attr("datetime")).get();
        const first = stamps[0] ? parseIsoAsLondonWallClock(stamps[0]) : null;
        const text = clean(body.text());
        const date = first?.date ?? parseDate(clean(card.find(".card-divider").text()));
        if (!url || !title || !date) return;
        const time = first?.time && stamps.length > 1 ? first.time : parseTime(text.replace(/\b\d{1,2}\s+\w+\s+\d{4}\b/g, " "));
        if (ctx.isBeyondHorizon(date)) beyond++;
        const paras = body.find("p").map((_, p) => clean($(p).text())).get();
        const venue = clean((paras.find((p) => !/\d{4}/.test(p)) ?? "").replace(/(?:book your place|no booking required|booking required|registration required).*$/i, ""));
        events.push({
          title,
          url,
          start: { date, time },
          end: stamps.length > 1 ? parseIsoAsLondonWallClock(stamps[stamps.length - 1]) : null,
          location: /^external$/i.test(venue) ? null : venue || null,
          online: /^online$/i.test(venue) ? true : /^hybrid$/i.test(venue) ? false : null,
          hints: [text],
        });
      });
      if (beyond === cards.length || !$(`a[href="?page=${page + 1}"]`).length) break;
    }

    const inWindow = events.filter((e) => ctx.inWindow(e.start) && !INTERNAL.test(e.title));
    return enrichAll(ctx, inWindow, 3, async (event) => {
      const $ = loadHtml(await ctx.http.text(event.url));
      const main = $("main").first();
      const lines = htmlToLines(main.html() ?? "");
      const venue = labelled(lines, /venue/i);
      const changed = lines.find((l) => /change of venue/i.test(l));
      // Venue-change notices are location, not description.
      const paras = main
        .find("p")
        .map((_, p) => clean($(p).text()))
        .get()
        .filter((t) => t.length > 80 && !/^(?:please )?note:?\s*(?:the )?change of venue/i.test(t));
      const description = paras.slice(0, 2).join(" ");
      let location = event.location;
      if (changed) location = clean(changed.replace(/^.*change of venue:?\s*/i, ""));
      else if (!location && venue && !/^external$/i.test(venue)) location = venue;
      return {
        ...event,
        location,
        description: description || null,
        speakers: uniqNames([...speakersFromTitle(event.title, description), ...honorificNames(description)]),
        hints: [...(event.hints ?? []), paras.join(" ").slice(0, 2000)],
      };
    }, (e) => e.url);
  },
};
