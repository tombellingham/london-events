/**
 * RSA (Royal Society of Arts) — thersa.org sits behind an interactive
 * Cloudflare challenge that automated browsers can't pass (tested from a
 * cloud VM and from GitHub Actions). RSA's public talks are ticketed through
 * its "RSA Public Talks" Eventbrite organizer, which we read instead; talks
 * appear there once booking opens.
 */

import type { Source } from "../core/types.ts";
import { scrapeEventbriteOrganizer } from "../core/eventbrite.ts";

export const rsa: Source = {
  id: "rsa",
  name: "RSA",
  homepage: "https://www.thersa.org/events",
  defaults: { location: "RSA House, 8 John Adam Street, WC2N 6EZ" },
  async scrape(ctx) {
    const events = await scrapeEventbriteOrganizer(ctx, "https://www.eventbrite.co.uk/o/rsa-public-talks-58752408", { details: true });
    // Eventbrite's venue record for RSA House is garbled ("8 John Adam St, Greater, 8 Greater…").
    return events.map((e) => (e.location && /john adam/i.test(e.location) ? { ...e, location: "RSA House, 8 John Adam Street, WC2N 6EZ" } : e));
  },
};
