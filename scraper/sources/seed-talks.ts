/**
 * Seed Talks — the London page lists every upcoming talk as a card linking
 * to its Eventbrite page (date, 🕐 time, 📍 venue, blurb); most cards also
 * have a schema.org Event in JSON-LD with price and attendance mode, which
 * we merge in by title. Online editions are marked "[online]" in the title.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseDate, parseNaiveLondon, parseTime } from "../core/dates.ts";
import { hasType, jsonLdNodes, loadHtml } from "../core/html.ts";
import { clean } from "../core/text.ts";

const PAGE = "https://www.seedtalks.co.uk/in/london";

interface LdEvent {
  name?: string;
  description?: string;
  startDate?: string;
  eventAttendanceMode?: string;
  location?: { name?: string; address?: { streetAddress?: string } | string };
  offers?: { price?: string; url?: string } | Array<{ price?: string; url?: string }>;
}

const key = (s: string) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const seedTalks: Source = {
  id: "seed-talks",
  name: "Seed Talks",
  homepage: PAGE,
  defaults: { free: false },
  async scrape(ctx) {
    const $ = loadHtml(await ctx.http.text(PAGE));
    const ld = new Map<string, LdEvent>();
    for (const node of jsonLdNodes($)) if (hasType(node, /^Event$/)) ld.set(key(String(node.name ?? "")), node as LdEvent);

    const events: RawEvent[] = [];
    $("article").each((_, el) => {
      const card = $(el);
      const link = card.find("h3 a").first();
      const title = clean(link.text());
      const href = link.attr("href");
      if (!title || !href) return;
      const iconText = (icon: string) =>
        clean(
          card
            .find("span")
            .filter((_, s) => clean($(s).children("span").first().text()) === icon)
            .first()
            .children("span")
            .eq(1)
            .text(),
        );
      const data = ld.get(key(title));
      const fromLd = data?.startDate ? parseNaiveLondon(data.startDate) : null;
      const date = fromLd?.date ?? parseDate(clean(card.find("time").first().text()));
      if (!date) return;
      const offers = Array.isArray(data?.offers) ? data?.offers[0] : data?.offers;
      const venue = iconText("📍") || clean(typeof data?.location === "object" ? data.location.name : "");
      const mode = data?.eventAttendanceMode ?? "";
      events.push({
        title,
        url: href.split("?")[0],
        start: { date, time: fromLd?.time ?? parseTime(iconText("🕐")) },
        location: venue || null,
        description: data?.description ?? clean(card.find("p").first().text()),
        priceText: offers?.price ? (Number(offers.price) === 0 ? "Free" : `£${offers.price}`) : null,
        online: /OnlineEventAttendanceMode/.test(mode) || /\[online\]/i.test(title) ? true : /OfflineEventAttendanceMode|MixedEventAttendanceMode/.test(mode) ? false : null,
      });
    });
    return events;
  },
};
