/**
 * Adapter for Gresham College (gresham.ac.uk).
 *
 * Gresham publishes their "What's On" listing as a pre-built JSON file rather
 * than server-rendering the events into HTML, so this is a straight fetch +
 * parse rather than a markup scrape. That's fragile in a different way to
 * HTML scraping — the shape of this JSON is undocumented and could change
 * without notice — so we validate defensively rather than trusting it blindly.
 */

import type { Event } from "./types";

const FEED_URL =
  "https://www.gresham.ac.uk/sites/default/files/attachments/whatson.json";
const SITE_ORIGIN = "https://www.gresham.ac.uk";
const SOURCE_NAME = "Gresham College";

// Only the fields we actually care about. The feed has a lot more
// (vocabOne, hiddenNodeRefs, content HTML, months, etc.) that we ignore.
interface GreshamRawEvent {
  id: number;
  title: string;
  excerpt?: string;
  link: string; // e.g. "/whats-on/why-empathy"
  calculated_start_date: string; // "2026-09-07 17:00:00", assumed Europe/London local time
  calculated_end_date?: string;
  hiddenNodeRefs?: Array<{ label: string }>;
}

interface GreshamFeed {
  events: GreshamRawEvent[];
}

/**
 * The feed's date strings have no timezone info and appear to be London
 * local time (both GMT and BST periods show up across the feed with no
 * offset adjustment). We parse the components manually rather than handing
 * the string to `new Date(...)`, since that would interpret it as UTC and
 * silently shift every event by an hour half the year.
 */
function parseLondonDateTime(raw: string): Date | null {
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
  );
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;

  // Construct as UTC components first, then correct for the London/UTC
  // offset at that instant. This avoids relying on the server's local
  // timezone (which may not be Europe/London in CI).
  const naiveUtc = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    )
  );

  const offsetMinutes = getLondonOffsetMinutes(naiveUtc);
  return new Date(naiveUtc.getTime() - offsetMinutes * 60_000);
}

/** Returns the UTC offset (in minutes) that Europe/London observes at the given instant. */
function getLondonOffsetMinutes(date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");

  const localMinutes = hour * 60 + minute;
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();

  let diff = localMinutes - utcMinutes;
  // Handle day-boundary wraparound.
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return diff;
}

function buildDescription(raw: GreshamRawEvent): string {
  const speakers = (raw.hiddenNodeRefs ?? [])
    .map((s) => s.label?.trim())
    .filter((label): label is string => Boolean(label));
  // hiddenNodeRefs mixes speaker names and their titles (e.g. "Professor
  // Jane Shaw" and "Professor of Astronomy" as separate entries) with no
  // reliable way to tell them apart, so we just join whatever's there.
  if (speakers.length > 0) {
    return `A Gresham College lecture with ${speakers.join(", ")}.`;
  }
  return "A Gresham College public lecture.";
}

export async function scrape(): Promise<Event[]> {
  const res = await fetch(FEED_URL, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(
      `Gresham feed returned ${res.status} ${res.statusText}`
    );
  }

  const data = (await res.json()) as GreshamFeed;

  if (!Array.isArray(data.events)) {
    throw new Error("Gresham feed shape changed: 'events' is not an array");
  }

  const events: Event[] = [];

  for (const raw of data.events) {
    try {
      if (!raw.title || !raw.link || !raw.calculated_start_date) {
        continue; // skip malformed entries rather than failing the whole adapter
      }

      const startDate = parseLondonDateTime(raw.calculated_start_date);
      if (!startDate || Number.isNaN(startDate.getTime())) {
        continue;
      }

      const endDate = raw.calculated_end_date
        ? parseLondonDateTime(raw.calculated_end_date)
        : null;

      events.push({
        title: raw.title.trim(),
        description: buildDescription(raw),
        startDate,
        endDate: endDate && !Number.isNaN(endDate.getTime()) ? endDate : undefined,
        url: new URL(raw.link, SITE_ORIGIN).toString(),
        source: SOURCE_NAME,
      });
    } catch {
      // Isolate failures to a single malformed event; keep going.
      continue;
    }
  }

  return events;
}