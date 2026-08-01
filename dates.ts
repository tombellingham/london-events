/**
 * Several event providers publish date strings like "2026-09-03 19:30:00"
 * with no timezone offset, but the values are Europe/London local time (they
 * don't shift to reflect BST/GMT consistently — they're just naive local
 * timestamps). Parsing these with `new Date(...)` treats them as UTC and
 * silently shifts every event by an hour for half the year, so we convert
 * properly instead.
 */
export function parseLondonDateTime(raw: string): Date | null {
  const match = raw
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;

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
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return diff;
}

/** Strips HTML tags and decodes the handful of entities likely to appear in short blurbs. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&quot;/g, '"')
    .replace(/&#8220;|&ldquo;/g, "“")
    .replace(/&#8221;|&rdquo;/g, "”")
    .replace(/\s+/g, " ")
    .trim();
}