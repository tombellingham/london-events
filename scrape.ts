import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Event } from "./types";
import { parseLondonDateTime } from "./dates";
import { runAllAdapters } from "./adapters";

const __dirname = dirname(fileURLToPath(import.meta.url));
// .build/ is a disposable build artefact directory — regenerated fresh on
// every run, not meant to be committed.
const OUTPUT_DIR = join(__dirname, ".build");
const OUTPUT_PATH = join(OUTPUT_DIR, "events.json");

/** Serialized form written to events.json — dates as ISO strings, not Date objects. */
interface SerializedEvent {
  title: string;
  description: string;
  startDate: string;
  endDate: string | undefined;
  url: string;
  source: string;
}

interface ScraperStatus {
  name: string;
  success: boolean;
  eventCount: number;
}

interface DateGroup {
  date: string;
  events: SerializedEvent[];
}

interface BuildOutput {
  scrapedAt: string;
  scrapers: ScraperStatus[];
  dates: DateGroup[];
}

async function main() {
  const results = await runAllAdapters();

  console.log("── Scrape summary ───────────────────────");
  for (const result of results) {
    const status = result.error ? `FAILED (${result.error})` : "ok";
    console.log(
      `${result.name.padEnd(20)} ${String(result.events.length).padStart(
        4
      )} events   ${status}`
    );
  }

  const allEvents = results.flatMap((r) => r.events);
  const { windowStart, windowEnd } = getFilterWindow();

  const filtered = allEvents
    .filter((e) => e.startDate >= windowStart && e.startDate < windowEnd)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  console.log(
    `\nFilter window: ${windowStart.toISOString()} to ${windowEnd.toISOString()}`
  );
  console.log(
    `${allEvents.length} events scraped in total → ${filtered.length} within window`
  );

  const failedAdapters = results.filter((r) => r.error);
  if (failedAdapters.length > 0) {
    console.warn(
      `⚠ ${failedAdapters.length} adapter(s) failed and contributed 0 events: ${failedAdapters
        .map((r) => r.name)
        .join(", ")}`
    );
  }

  // A raw scrape of exactly 0 events (with no thrown error) usually means
  // something silently broke — a selector stopped matching, a site
  // restructured its markup, a listing page came back empty when it
  // shouldn't — rather than that the venue genuinely has nothing on. We
  // treat that the same as a thrown error for status-reporting purposes,
  // even though the adapter itself didn't fail.
  const zeroRawAdapters = results.filter(
    (r) => r.error === null && r.events.length === 0
  );
  if (zeroRawAdapters.length > 0) {
    console.warn(
      `⚠ ${zeroRawAdapters.length} adapter(s) ran without error but scraped 0 events (likely broken, not empty): ${zeroRawAdapters
        .map((r) => r.name)
        .join(", ")}`
    );
  }

  // If every adapter failed, something is almost certainly wrong with the
  // build environment itself (network egress, a shared dependency broke,
  // etc.) rather than with any one site — fail loudly instead of silently
  // publishing an empty events.json.
  if (allEvents.length === 0) {
    console.error("✗ Every adapter returned zero events — aborting build.");
    process.exit(1);
  }

  const dates: DateGroup[] = groupEventsByDay(filtered);
  const scraperStatuses: ScraperStatus[] = results.map((r) => {
    const filteredCountForSource = filtered.filter(
      (e) => e.source === r.name
    ).length;

    return {
      name: r.name,
      // Both a thrown error AND a raw scrape of 0 count as failure here —
      // see the zeroRawAdapters check above for why the latter counts too.
      success: r.error === null && r.events.length > 0,
      eventCount: filteredCountForSource,
    };
  });

  const output: BuildOutput = {
    scrapedAt: new Date().toISOString(),
    scrapers: scraperStatuses,
    dates,
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf-8");
  console.log(
    `\n✓ Wrote ${filtered.length} events across ${dates.length} day(s) to ${OUTPUT_PATH}`
  );
}

function serializeEvent(event: Event): SerializedEvent {
  return {
    title: event.title,
    description: event.description,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate?.toISOString(),
    url: event.url,
    source: event.source,
  };
}

/**
 * Groups already-filtered, already-chronologically-sorted events by the
 * London calendar day their startDate falls on — NOT the UTC day, since an
 * event at 11pm BST is still "today" in London even though its UTC
 * timestamp has already rolled into the next date.
 *
 * Relies on `events` being pre-sorted by startDate ascending: JS Map
 * preserves insertion order, so grouping in a single pass naturally
 * produces day-groups in chronological order too, with no separate sort
 * needed afterwards. Only dates with at least one event appear — there's
 * no pre-seeding of empty day slots.
 */
function groupEventsByDay(events: Event[]): DateGroup[] {
  const groups = new Map<string, SerializedEvent[]>();

  for (const event of events) {
    const dayKey = formatLondonDateKey(event.startDate);
    if (!groups.has(dayKey)) {
      groups.set(dayKey, []);
    }
    groups.get(dayKey)!.push(serializeEvent(event));
  }

  return Array.from(groups.entries()).map(([date, dayEvents]) => ({
    date,
    events: dayEvents,
  }));
}

/** Formats a Date as "YYYY-MM-DD" using Europe/London wall-clock date, regardless of build-machine timezone. */
function formatLondonDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Computes the filter window in Europe/London wall-clock terms, independent
 * of the timezone the build actually runs in (CI runners are typically UTC):
 *   - windowStart: midnight at the start of today (London) — events earlier
 *     today are still included, since "today" counts as "not yet passed"
 *     for a daily-refreshed listing site.
 *   - windowEnd: midnight one calendar month later. Uses calendar month
 *     arithmetic (not "30 days"), so e.g. 1 Aug → 1 Sep, 31 Jan → 28/29 Feb
 *     (clamped to the shorter month's last day rather than overflowing).
 */
function getFilterWindow(): { windowStart: Date; windowEnd: Date } {
  const now = new Date();
  const londonParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = Number(londonParts.find((p) => p.type === "year")!.value);
  const month = Number(londonParts.find((p) => p.type === "month")!.value);
  const day = Number(londonParts.find((p) => p.type === "day")!.value);

  const windowStart = parseLondonDateTime(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} 00:00:00`
  );
  if (!windowStart) {
    throw new Error("Failed to compute filter window start — this should be unreachable");
  }

  let endYear = year;
  let endMonth = month + 1;
  if (endMonth > 12) {
    endMonth = 1;
    endYear += 1;
  }
  const daysInEndMonth = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  const endDay = Math.min(day, daysInEndMonth);

  const windowEnd = parseLondonDateTime(
    `${endYear}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")} 00:00:00`
  );
  if (!windowEnd) {
    throw new Error("Failed to compute filter window end — this should be unreachable");
  }

  return { windowStart, windowEnd };
}

main().catch((err) => {
  console.error("Build crashed:", err);
  process.exit(1);
});
