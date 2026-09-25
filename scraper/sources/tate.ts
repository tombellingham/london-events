/**
 * Tate (Tate Modern + Tate Britain) — the What's On search filtered to talks
 * at the two London galleries, paginated with ?page=N. Cards only give a
 * date; each event page gives "Date & Time" (one line per session). Prices
 * load client-side, so free/paid comes from running the same search with
 * Tate's own `prices=free` filter. Standing daily programmes (free guided
 * tours, 10-minute talks) list a date range rather than sessions and are skipped.
 */

import type { RawEvent, ScrapeContext, Source } from "../core/types.ts";
import { parseDate, parseTime } from "../core/dates.ts";
import { absUrl, loadHtml } from "../core/html.ts";
import { clean, speakersFromTitle } from "../core/text.ts";
import { mapSettled } from "../core/async.ts";

const SITE = "https://www.tate.org.uk";
const LISTING = `${SITE}/whats-on?date_range=from_now&event_type=talk&gallery_group=tate-modern&gallery_group=tate-britain`;

interface Card {
  url: string;
  description: string;
  venue: string;
}

async function listing(ctx: ScrapeContext, base: string): Promise<Card[]> {
  const cards: Card[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 10; page++) {
    const $ = loadHtml(await ctx.http.text(page > 1 ? `${base}&page=${page}` : base));
    const found = $(".card a[href^='/whats-on/']");
    if (found.length === 0) break;
    found.each((_, a) => {
      const link = $(a);
      const url = absUrl(link.attr("href"), SITE);
      if (!url || seen.has(url)) return;
      seen.add(url);
      cards.push({
        url,
        description: clean(link.find(".card__description").text()),
        venue: clean(link.find(".event-info__venue span").text()),
      });
    });
    if (!$(`a[href*="page=${page + 1}"]`).length) break;
  }
  return cards;
}

export const tate: Source = {
  id: "tate",
  name: "Tate",
  homepage: `${SITE}/whats-on?event_type=talk`,
  defaults: { online: false },
  async scrape(ctx) {
    const cards = await listing(ctx, LISTING);
    const freeUrls = new Set((await listing(ctx, `${LISTING}&prices=free`)).map((c) => c.url));

    const perCard = await mapSettled(cards, 3, async (card): Promise<RawEvent[]> => {
      const $ = loadHtml(await ctx.http.text(card.url));
      // <h1><span class="…surtitle">Show and Share</span><span>Avant-Garde Ambassadors</span></h1>
      const parts = $("h1").first().children("span").map((_, s) => clean($(s).text())).get().filter(Boolean);
      const title = parts.length > 1 ? parts.join(": ").replace(/::/g, ":") : clean($("h1").first().text());
      const sessions = $(".content-block--dates__item").map((_, p) => clean($(p).text())).get();
      const out: RawEvent[] = [];
      for (const session of sessions) {
        // "9 October 2026 at 14.00–17.00"; "Until 3 Jan 2027" / "Daily" aren't dated sessions.
        if (/^(?:until|daily|every|from)\b/i.test(session)) continue;
        const date = parseDate(session);
        if (!date) continue;
        out.push({
          title,
          url: card.url,
          start: { date, time: parseTime(session.split(/\bat\b/i)[1] ?? "") },
          location: card.venue || null,
          description: card.description || null,
          speakers: speakersFromTitle(title, card.description),
          free: freeUrls.has(card.url),
        });
      }
      return out;
    }, (card, err) => ctx.log.warn(`event page failed ${card.url}: ${String(err)}`));
    return perCard.flat();
  },
};
