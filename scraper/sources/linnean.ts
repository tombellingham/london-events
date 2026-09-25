/**
 * Linnean Society — linnean.org's event list links into its VeryConnect
 * members portal, whose public JSON API returns every upcoming public event
 * (UTC start instants, remote flag, venue, HTML description), 20 at a time.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseIsoInstant } from "../core/dates.ts";
import { clean } from "../core/text.ts";

const PORTAL = "https://members.linnean.org";
const PAGE = 20;

interface VcTicket {
  name?: string;
  price?: number | string;
  cost?: number | string;
}
interface VcEvent {
  id: string;
  title: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  remote?: boolean;
  hybrid?: boolean | null;
  location?: { formatted_address?: string } | null;
  venue?: string | null;
  tickets?: VcTicket[];
  status?: string;
}

function ticketPrice(tickets: VcTicket[] | undefined): string | null {
  const prices = (tickets ?? [])
    .map((t) => Number(t.price ?? t.cost))
    .filter((n) => Number.isFinite(n));
  if (prices.length === 0) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  // VeryConnect prices are in pence.
  const fmt = (p: number) => (p === 0 ? "Free" : `£${(p / 100).toFixed(2).replace(/\.00$/, "")}`);
  return min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`;
}

export const linnean: Source = {
  id: "linnean",
  name: "Linnean Society",
  homepage: "https://www.linnean.org/meetings-and-events/events",
  defaults: { location: "Linnean Society, Burlington House, Piccadilly" },
  async scrape(ctx) {
    const events: RawEvent[] = [];
    for (let skip = 0; skip < 400; skip += PAGE) {
      const params = new URLSearchParams({ limit: String(PAGE), skip: String(skip), status: "published", future: "true", sort: "true", roles: "public" });
      const page = await ctx.http.json<VcEvent[]>(`${PORTAL}/api/v1/event?${params}`);
      if (!Array.isArray(page)) throw new Error("VeryConnect API shape changed");
      for (const e of page) {
        const start = parseIsoInstant(e.start_date ?? "");
        if (!start || e.status !== "published") continue;
        const address = clean(e.location?.formatted_address ?? e.venue ?? "");
        events.push({
          title: e.title,
          url: `${PORTAL}/events/${e.id}/description`,
          start,
          end: parseIsoInstant(e.end_date ?? ""),
          location: e.remote && !e.hybrid ? "Online" : address || null,
          online: e.remote === true && !e.hybrid ? true : e.remote === false ? false : null,
          description: e.description ?? null,
          priceText: ticketPrice(e.tickets),
        });
      }
      const last = page.at(-1)?.start_date;
      if (page.length < PAGE || (last && ctx.isBeyondHorizon(parseIsoInstant(last) ?? new Date(8.64e15)))) break;
    }
    return events;
  },
};
