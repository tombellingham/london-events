/**
 * UCL — www.ucl.ac.uk sits behind an interactive Cloudflare challenge that no
 * headless browser passes (tested from both a cloud VM and GitHub Actions).
 * But every UCL department's event listing is fed by a public Funnelback
 * search collection on cms-feed.ucl.ac.uk, and `drupal-meta-events` is the
 * university-wide index. We read that JSON, restricted to events whose
 * audience includes the public, and link to the canonical ucl.ac.uk pages
 * (which work fine in a normal browser).
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseIsoInstant, parseNaiveLondon } from "../core/dates.ts";
import { clean } from "../core/text.ts";

const FEED = "https://cms-feed.ucl.ac.uk/s/search.json";
const PAGE = 100;

type Meta = Record<string, string[] | undefined>;
interface Result {
  liveUrl: string;
  title: string;
  listMetadata?: Meta;
}
interface FeedResponse {
  response: { resultPacket: { results: Result[]; resultsSummary: { totalMatching: number; nextStart: number | null } } };
}

const first = (m: Meta, key: string) => clean(m[key]?.[0] ?? "");

/** Event types that are talks/lectures/discussions rather than courses, open days or staff training. */
const SKIP_TYPES = /^(?:workshop|virtual open day|open day|open event|information session|short course|online learning|face-to-face learning|taster session|continuing professional development|networking|tour|training|summer school|induction)/i;

export const ucl: Source = {
  id: "ucl",
  name: "UCL",
  homepage: "https://www.ucl.ac.uk/events/",
  defaults: { free: true, location: "UCL, Bloomsbury" },
  async scrape(ctx) {
    const events: RawEvent[] = [];
    for (let start = 1; start < 2000; start += PAGE) {
      const params = new URLSearchParams({
        collection: "drupal-meta-events",
        num_ranks: String(PAGE),
        start_rank: String(start),
        "f.Audiences|UclAudience": "Public",
      });
      const data = await ctx.http.json<FeedResponse>(`${FEED}?${params}`);
      const packet = data.response.resultPacket;
      for (const r of packet.results) {
        const m = r.listMetadata ?? {};
        const startRaw = first(m, "UclEventStartDate");
        const instant = parseIsoInstant(startRaw);
        const when = instant ?? parseNaiveLondon(startRaw);
        if (!when) continue;
        const type = first(m, "UclEventType");
        if (SKIP_TYPES.test(type)) continue;
        const location = [first(m, "UclEventLocationRoom"), first(m, "UclEventLocationBuilding"), first(m, "UclEventLocationStreet"), first(m, "UclEventLocationCity"), first(m, "UclEventLocationPostcode")]
          .filter(Boolean)
          .join(", ");
        const cost = first(m, "UclEventCost");
        const currency = first(m, "UclEventCurrency");
        const endRaw = first(m, "UclEventEndDate");
        events.push({
          title: first(m, "FeedTitle") || r.title.split(" | ")[0],
          url: r.liveUrl,
          start: when,
          end: parseIsoInstant(endRaw) ?? parseNaiveLondon(endRaw),
          location: location || null,
          description: first(m, "c"),
          priceText: cost ? (Number(cost) === 0 ? "Free" : `${currency === "GBP" || !currency ? "£" : currency + " "}${cost}`) : null,
          online: /^(?:virtual event|webinar)$/i.test(type) ? true : null,
          hints: [type, ...(m.UclOrgUnit ?? [])],
          tags: type ? [type] : [],
        });
      }
      if (!packet.resultsSummary.nextStart) break;
    }
    return events;
  },
};
