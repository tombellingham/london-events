import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// This file lives at src/_data/, and events.json is written by build.ts to
// .build/ at the project root — climb up two levels to reach it.
const EVENTS_PATH = join(__dirname, "..", "..", ".build", "events.json");

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

function ordinal(day) {
  if (day % 10 === 1 && day !== 11) return `${day}st`;
  if (day % 10 === 2 && day !== 12) return `${day}nd`;
  if (day % 10 === 3 && day !== 13) return `${day}rd`;
  return `${day}th`;
}

/**
 * dateStr is "YYYY-MM-DD" (already a London calendar date, from build.ts).
 * Parsed as plain components and passed through Date.UTC purely to derive
 * the day-of-week (which doesn't depend on timezone for a given calendar
 * date) — not used for any timezone conversion.
 */
function formatDayLabel(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${MONTHS[month - 1]} ${ordinal(day)}`;
}

function formatEventTime(isoString) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(isoString));
}

/**
 * "Last scraped on Monday September 5th" — an absolute date rather than a
 * relative "X hours/days ago" label, so it reads correctly no matter how
 * long the static page has been sitting since its last build (a relative
 * label frozen into static HTML goes stale the moment it's rendered — see
 * the .build/events.json's actual scrapedAt timestamp for the precise
 * instant, if that's ever needed).
 */
function formatScrapedAtLabel(isoString) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).formatToParts(new Date(isoString));

  const weekday = parts.find((p) => p.type === "weekday").value;
  const month = parts.find((p) => p.type === "month").value;
  const day = Number(parts.find((p) => p.type === "day").value);

  return `${weekday} ${month} ${ordinal(day)}`;
}

export default async function () {
  let raw;

  try {
    raw = JSON.parse(readFileSync(EVENTS_PATH, "utf-8"));
  } catch {
    console.warn(
      `⚠ Could not read ${EVENTS_PATH} — have you run \`npm run scrape\` yet? Building with an empty event list.`
    );
    return { dates: [], scrapers: [], lastScrapedLabel: null };
  }

  const dates = (raw.dates ?? []).map((group) => ({
    date: group.date,
    label: formatDayLabel(group.date),
    events: group.events.map((event) => ({
      ...event,
      displayTime: formatEventTime(event.startDate),
    })),
  }));

  const lastScrapedLabel = raw.scrapedAt
    ? formatScrapedAtLabel(raw.scrapedAt)
    : null;

  const scrapers = (raw.scrapers ?? []).slice().sort((a, b) =>
    (b.eventCount ?? 0) - (a.eventCount ?? 0)
  );

  return { dates, scrapers, lastScrapedLabel };
}
