/**
 * The pipeline's memory between runs is the live site itself: each run reads
 * back what the last deploy published (the run history, and each source's
 * last good scrape) and publishes the updated copies. No database, no commits.
 */

import type { HistoryEntry, SourceSnapshot } from "./types.ts";

/** A JSON file the site published under /data/ (null when missing or unreadable). */
export async function fetchPublished(siteUrl: string, path: string): Promise<unknown> {
  try {
    const res = await fetch(`${siteUrl.replace(/\/$/, "")}/data/${path}`, { signal: AbortSignal.timeout(15_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function publishedHistory(siteUrl: string): Promise<HistoryEntry[]> {
  const data = await fetchPublished(siteUrl, "history.json");
  return Array.isArray(data) ? (data as HistoryEntry[]).filter((h) => h && typeof h.at === "string") : [];
}

/** A source's last good scrape, as published by the last deploy. */
export async function publishedSnapshot(siteUrl: string, sourceId: string): Promise<SourceSnapshot | null> {
  const data = (await fetchPublished(siteUrl, `sources/${sourceId}.json`)) as Partial<SourceSnapshot> | null;
  if (!data || data.id !== sourceId || typeof data.scrapedAt !== "string" || !Number.isFinite(Date.parse(data.scrapedAt)) || !Array.isArray(data.events)) return null;
  const events = data.events.filter(
    (e) => e && typeof e.title === "string" && typeof e.url === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? "") && typeof e.start === "string" && Array.isArray(e.speakers),
  );
  return { id: sourceId, scrapedAt: data.scrapedAt, events };
}
