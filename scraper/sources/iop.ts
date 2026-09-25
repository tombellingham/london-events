/**
 * Institute of Physics — /events (Drupal view, 12 per page, ?page=N from 0)
 * lists IOP events across the UK and Ireland: type ("In-person" / "Online"),
 * title and "Starts Tue 29 Sep 2026 19:30". Each event page has the address
 * ("Where"), the description and topic/region/audience tags. Kept: in-person
 * (or hybrid) events whose address is in London; dropped: online-only events,
 * membership/careers admin sessions and teacher-only CPD.
 *
 * iop.org answers only a real (headed) browser from CI.
 */

import type { LondonDateTime, RawEvent, Source } from "../core/types.ts";
import { absUrl, loadHtml } from "../core/html.ts";
import { clean, honorificNames, speakersFromTitle } from "../core/text.ts";
import { parseDateTime } from "../core/dates.ts";
import { enrichAll } from "../core/async.ts";
import { isInLondon } from "../core/classify.ts";
import { fetchHtml, laterPage, preferBrowser } from "../core/fetch.ts";

const SITE = "https://www.iop.org";
// Plain requests from CI always meet a bot wall here.
preferBrowser("www.iop.org");

const ADMIN = /\b(?:membership|professional registration|chartered|careers?|mentoring|annual general meeting|agm|cpd)\b/i;

type Listed = RawEvent & { start: LondonDateTime; kind: string; skip?: boolean };

export const iop: Source = {
  id: "iop",
  name: "Institute of Physics",
  homepage: `${SITE}/events`,
  timeoutMs: 480_000,
  include: (e) => !ADMIN.test(e.title) && isInLondon(e.location),
  async scrape(ctx) {
    const listed: Listed[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < 15; page++) {
      const html = await laterPage(ctx, page, 0, () => fetchHtml(ctx, page ? `${SITE}/events?page=${page}` : `${SITE}/events`, { browser: { waitFor: ".iop-media-block--event" } }));
      if (html === null) break;
      const $ = loadHtml(html);
      const cards = $(".iop-media-block--event");
      if (!cards.length) break;
      let beyond = 0;
      cards.each((_, el) => {
        const card = $(el);
        const url = absUrl(card.find("a.iop-media-block__cta").attr("href"), SITE);
        const title = clean(card.find(".iop-media-block__heading").text());
        const start = parseDateTime(clean(card.find(".iop-media-block__date p").first().text()));
        if (!url || !title || !start || seen.has(url)) return;
        seen.add(url);
        if (ctx.isBeyondHorizon(start)) beyond++;
        const endText = clean(card.find(".iop-media-block__date p").eq(1).text());
        const end = endText ? parseDateTime(endText) : null;
        const kind = clean(card.find(".iop-media-block__event-type").text());
        listed.push({ title, url, start, end, kind, online: /^online$/i.test(kind) ? true : null, speakers: speakersFromTitle(title) });
      });
      if (beyond === cards.length) break;
    }

    // Online-only events are out of scope: don't spend a (browser) page load on them.
    const candidates = listed.filter((e) => ctx.inWindow(e.start) && !ADMIN.test(e.title) && e.online !== true);
    const detailed = await enrichAll<Listed>(
      ctx,
      candidates,
      2,
      async (event) => {
        const $ = loadHtml(await fetchHtml(ctx, event.url, { browser: { waitFor: ".event-metadata" } }));
        const address = $(".event-metadata__address p")
          .first()
          .html()
          ?.split(/<br\s*\/?>/i)
          .map((part) => clean(loadHtml(part).text()))
          .filter(Boolean)
          .join(", ");
        const tags = $(".iop-inline-link-list a").map((_, a) => clean($(a).text())).get();
        const paras = $(".iop-event-desc p").map((_, p) => clean($(p).text())).get().filter((t) => t.length > 30);
        const description = paras.join(" ");
        // Teacher CPD is listed alongside public events; keep it only when the public is invited too.
        const audiences = tags.filter((t) => /teachers|students|members|public|everyone|families|adults/i.test(t));
        if (audiences.length && audiences.every((t) => /teachers|school/i.test(t))) return { ...event, skip: true };
        const online = event.online === true || tags.some((t) => /^online$|^virtual$/i.test(t));
        return {
          ...event,
          location: online ? "Online" : address || null,
          online: online ? true : /hybrid/i.test(`${event.kind} ${tags.join(" ")}`) ? false : event.online,
          description: description || null,
          speakers: [...(event.speakers ?? []), ...honorificNames(description)],
          hints: [tags.join(", "), event.kind],
        };
      },
      (e) => e.url,
    );
    return detailed.filter((e) => !e.skip).map(({ kind: _kind, skip: _skip, ...event }) => event);
  },
};
