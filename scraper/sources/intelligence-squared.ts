/**
 * Intelligence Squared — its own site (/attend and every event page) sits
 * behind a Cloudflare wall that blocks both plain requests and a real
 * browser, but it sells its tickets through Eventbrite, so we read its
 * Eventbrite organizer listing (structured dates, venues, prices) and each
 * event page for a description. Touring shows are listed per date and city;
 * only London dates are kept.
 */

import type { Source } from "../core/types.ts";
import { scrapeEventbriteOrganizer } from "../core/eventbrite.ts";

const ORGANIZER = "https://www.eventbrite.co.uk/o/intelligence-squared-18003882117";

export const intelligenceSquared: Source = {
  id: "intelligence-squared",
  name: "Intelligence Squared",
  homepage: "https://www.intelligencesquared.com/attend",
  defaults: { free: false, online: false },
  async scrape(ctx) {
    const events = await scrapeEventbriteOrganizer(ctx, ORGANIZER, { details: true });
    // Touring shows also list dates outside London.
    return events.filter((e) => !e.location || /london/i.test(e.location));
  },
};
