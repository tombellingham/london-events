/**
 * Frontline Club — its events page is an Eventbrite widget, so we read the
 * club's Eventbrite organizer page directly (structured dates, venue and
 * prices) and each event's page for a description.
 */

import type { Source } from "../core/types.ts";
import { scrapeEventbriteOrganizer } from "../core/eventbrite.ts";

export const frontlineClub: Source = {
  id: "frontline-club",
  name: "Frontline Club",
  homepage: "https://www.frontlineclub.com/events/",
  defaults: { location: "Frontline Club, 13 Norfolk Place, W2 1QJ" },
  scrape: (ctx) => scrapeEventbriteOrganizer(ctx, "https://www.eventbrite.co.uk/o/frontline-club-29840816681", { details: true }),
};
