/**
 * Guildhall Library (City of London) — the City's website only links to a
 * PDF programme; every talk, walk and online event is booked through the
 * library's Eventbrite organizer page, which we read (structured dates,
 * venue, online flag, prices) plus each event page for the description.
 * Titles carry "In-Person Only:" / "Online Only:" prefixes, which become the
 * format flag. Talks are free unless stated; walks are ticketed.
 */

import type { Source } from "../core/types.ts";
import { scrapeEventbriteOrganizer } from "../core/eventbrite.ts";

export const guildhallLibrary: Source = {
  id: "guildhall-library",
  name: "Guildhall Library",
  homepage: "https://www.cityoflondon.gov.uk/things-to-do/history-and-heritage/guildhall-library/guildhall-library-events-and-exhibitions/guildhall-library-events",
  defaults: { location: "Guildhall Library, Aldermanbury, EC2V 7HH" },
  scrape: (ctx) => scrapeEventbriteOrganizer(ctx, "https://www.eventbrite.co.uk/o/guildhall-library-3623855655", { details: true }),
};
