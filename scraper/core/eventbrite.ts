/**
 * Eventbrite organizer pages ("/o/<slug>-<id>") embed the organizer's
 * upcoming events in __NEXT_DATA__ — structured start date/time, venue,
 * online flag and price. Several sources sell (or only publish) through
 * Eventbrite, and it is the only unprotected listing for RSA's public talks.
 */

import type { RawEvent, ScrapeContext } from "./types.ts";
import { hasType, jsonLdNodes, loadHtml, nextData } from "./html.ts";
import { clean } from "./text.ts";
import { parseIsoInstant } from "./dates.ts";
import { enrichAll } from "./async.ts";

interface EbVenue {
  name?: string;
  address?: { localized_address_display?: string; city?: string };
}

interface EbEvent {
  id: string;
  name: string;
  url: string;
  start_date: string;
  start_time: string;
  summary?: string;
  is_online_event?: boolean;
  is_cancelled?: boolean;
  primary_venue?: EbVenue;
  ticket_availability?: {
    is_free?: boolean;
    minimum_ticket_price?: { major_value?: string; display?: string; currency?: string };
    maximum_ticket_price?: { major_value?: string; display?: string };
    is_sold_out?: boolean;
  };
  series_id?: string | null;
}

interface OrganizerPageProps {
  organizer?: { id: string; name: string };
  upcomingEvents?: EbEvent[];
  hasMoreUpcoming?: boolean;
}

function venueText(venue: EbVenue | undefined): string | null {
  if (!venue?.name && !venue?.address?.localized_address_display) return null;
  return clean([venue.name, venue.address?.localized_address_display].filter(Boolean).join(", "));
}

function priceText(ev: EbEvent): string | null {
  const t = ev.ticket_availability;
  if (!t) return null;
  if (t.is_free) return "Free";
  const min = Number(t.minimum_ticket_price?.major_value);
  const max = Number(t.maximum_ticket_price?.major_value);
  const sym = (t.minimum_ticket_price?.currency ?? "GBP") === "GBP" ? "£" : "";
  if (Number.isFinite(min) && min === 0 && Number.isFinite(max) && max > 0) return `Free – ${sym}${max.toFixed(2)}`;
  if (Number.isFinite(min) && min === 0) return "Free";
  if (Number.isFinite(min) && min > 0) return max > min ? `${sym}${min.toFixed(2)} – ${sym}${max.toFixed(2)}` : `${sym}${min.toFixed(2)}`;
  return t.minimum_ticket_price?.display ?? null;
}

export function eventbriteEventToRaw(ev: EbEvent): RawEvent | null {
  if (!ev?.name || !ev.url || !ev.start_date || ev.is_cancelled) return null;
  return {
    title: ev.name,
    url: ev.url.split("?")[0],
    start: { date: ev.start_date, time: ev.start_time ? ev.start_time.slice(0, 5) : null },
    location: ev.is_online_event ? "Online" : venueText(ev.primary_venue),
    online: typeof ev.is_online_event === "boolean" ? ev.is_online_event : null,
    description: ev.summary || null,
    priceText: priceText(ev),
    free: ev.ticket_availability?.is_free === true ? true : null,
  };
}

/**
 * Upcoming events for one Eventbrite organizer. Uses the organizer page's own
 * JSON endpoint (20 per page, paged until past the horizon); falls back to
 * the events embedded in the page's __NEXT_DATA__ if that endpoint changes.
 */
export async function scrapeEventbriteOrganizer(
  ctx: ScrapeContext,
  organizerUrl: string,
  options: { details?: boolean } = {},
): Promise<RawEvent[]> {
  const organizerId = organizerUrl.match(/-(\d+)\/?$/)?.[1] ?? organizerUrl.match(/\/o\/(\d+)/)?.[1];
  if (!organizerId) throw new Error(`Can't find an organizer id in ${organizerUrl}`);
  const origin = new URL(organizerUrl).origin;

  let raw: EbEvent[] = [];
  try {
    for (let page = 1; page <= 15; page++) {
      const params = new URLSearchParams({ from_date: ctx.horizon.fromDate, page: String(page), page_size: "20", order_by: "start_asc", include_started: "true" });
      const data = await ctx.http.json<{ events?: EbEvent[]; has_more?: boolean }>(
        `${origin}/organizer-profile/api/organizers/${organizerId}/events-from-date/?${params}`,
        { headers: { Referer: organizerUrl } },
      );
      const events = data.events ?? [];
      raw.push(...events);
      const last = events.at(-1)?.start_date;
      if (!data.has_more || events.length === 0 || (last && ctx.isBeyondHorizon(last))) break;
    }
  } catch (err) {
    ctx.log.warn(`organizer events API failed (${String(err).slice(0, 120)}); using the page's embedded events`);
    const html = await ctx.http.text(organizerUrl);
    const data = nextData<{ props?: { pageProps?: OrganizerPageProps } }>(loadHtml(html));
    const props = data?.props?.pageProps;
    if (!props?.upcomingEvents) throw new Error(`No Eventbrite organizer data at ${organizerUrl}`);
    raw = props.upcomingEvents;
  }

  const events = raw.map(eventbriteEventToRaw).filter((e): e is RawEvent => e !== null);
  if (!options.details) return events;

  const inWindow = events.filter((e) => !ctx.isBeyondHorizon(e.start));
  return enrichAll(ctx, inWindow, 3, async (event) => {
    const detail = await eventbriteEventDetails(ctx, event.url);
    return { ...event, description: detail.description ?? event.description, start: detail.start ?? event.start };
  }, (e) => e.url);
}

/** Description / start instant from an Eventbrite event page's JSON-LD. */
export async function eventbriteEventDetails(ctx: ScrapeContext, url: string): Promise<{ description: string | null; start: Date | null }> {
  const $ = loadHtml(await ctx.http.text(url));
  const node = jsonLdNodes($).find((n) => hasType(n, /Event$/));
  const start = typeof node?.startDate === "string" ? parseIsoInstant(node.startDate) : null;
  const description = typeof node?.description === "string" ? node.description : null;
  return { description, start };
}
