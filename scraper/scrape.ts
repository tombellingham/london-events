/**
 * CLI: scrape every source → normalize → de-duplicate → write the build data.
 *
 *   npm run scrape                       # everything, writes .build/*.json
 *   npm run scrape -- --only=lse,kcl     # a subset
 *   npm run scrape -- --only=lse --print # dev: print events, don't write
 *
 * Outputs (consumed by the Eleventy build in src/):
 *   .build/events.json   the event blob shipped to the browser
 *   .build/health.json   this run's per-source status
 *   .build/history.json  rolling history of runs (previous copy is read back
 *                        from the live site, so no database or commits needed)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sources as allSources } from "./sources/index.ts";
import { runSources } from "./core/runner.ts";
import type { EventRecord, HistoryEntry, RunSummary } from "./core/types.ts";

const OUT_DIR = join(process.cwd(), ".build");
const SITE_URL = (process.env.SITE_URL ?? "https://tombellingham.github.io/london-events").replace(/\/$/, "");
const HISTORY_LIMIT = 90;

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(prefix));
  if (!hit) return undefined;
  return hit === `--${name}` ? "true" : hit.slice(prefix.length);
}

async function previousHistory(): Promise<HistoryEntry[]> {
  if (arg("no-history")) return [];
  try {
    const res = await fetch(`${SITE_URL}/data/history.json`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as HistoryEntry[]).filter((h) => h && typeof h.at === "string") : [];
  } catch {
    return [];
  }
}

function historyEntry(summary: RunSummary): HistoryEntry {
  return {
    at: summary.finishedAt,
    ok: summary.totals.ok,
    empty: summary.totals.empty,
    failed: summary.totals.failed,
    events: summary.totals.events,
    counts: Object.fromEntries(summary.sources.map((s) => [s.id, s.status === "error" ? -1 : s.count])),
  };
}

function printEvents(events: EventRecord[]): void {
  for (const e of events) {
    const flags = [e.free === true ? "free" : e.free === false ? "paid" : "free?", e.online === true ? "online" : e.online === false ? "in-person" : "format?"].join(",");
    console.log(`\n${e.date} ${e.time ?? "--:--"}  [${e.source}] ${e.title}`);
    console.log(`   ${flags}${e.price ? ` · ${e.price}` : ""} · ${e.location ?? "(no location)"}`);
    if (e.speakers.length) console.log(`   speakers: ${e.speakers.join("; ")}`);
    if (e.description) console.log(`   ${e.description.slice(0, 160)}`);
    console.log(`   ${e.url}`);
  }
}

function printSummary(summary: RunSummary): void {
  console.log("\n── Sources ─────────────────────────────────────────────────────────");
  const rows = [...summary.sources].sort((a, b) => a.name.localeCompare(b.name));
  for (const s of rows) {
    const status = s.status === "ok" ? "ok   " : s.status === "empty" ? "EMPTY" : "FAIL ";
    const dropped = Object.entries(s.dropped).map(([k, v]) => `${k}:${v}`).join(" ");
    console.log(
      `${status} ${s.name.padEnd(42)} ${String(s.count).padStart(4)} events  ${String(s.scraped).padStart(4)} scraped  ${String(s.requests).padStart(3)} req  ${(s.durationMs / 1000).toFixed(1).padStart(5)}s  ${dropped}${s.error ? `\n      ↳ ${s.error}` : ""}`,
    );
    if (arg("drops")) for (const d of s.dropSamples) console.log(`      · ${d}`);
  }
  const t = summary.totals;
  console.log(`\n${t.events} events · ${t.ok}/${t.sources} sources ok · ${t.empty} empty · ${t.failed} failed · ${t.duplicatesRemoved} duplicates removed · ${(summary.durationMs / 1000).toFixed(0)}s`);
}

async function main(): Promise<void> {
  const only = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean);
  const skip = arg("skip")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const horizonDays = Number(arg("horizon") ?? process.env.HORIZON_DAYS ?? 45);
  const print = Boolean(arg("print"));

  const unknown = [...(only ?? []), ...skip].filter((id) => !allSources.some((s) => s.id === id));
  if (unknown.length) throw new Error(`Unknown source id(s): ${unknown.join(", ")}. Known: ${allSources.map((s) => s.id).join(", ")}`);
  const selected = allSources.filter((s) => (!only || only.includes(s.id)) && !skip.includes(s.id));

  const { events, summary } = await runSources(selected, {
    horizonDays,
    concurrency: Number(process.env.SCRAPE_CONCURRENCY ?? 6),
    retryBlocked: process.env.RETRY_BLOCKED !== "0",
  });

  if (print) printEvents(events);
  printSummary(summary);

  if (!print && !arg("no-write")) {
    mkdirSync(OUT_DIR, { recursive: true });
    const catalog = allSources.map((s) => ({ id: s.id, name: s.name, homepage: s.homepage }));
    writeFileSync(
      join(OUT_DIR, "events.json"),
      JSON.stringify({ generatedAt: summary.finishedAt, horizonDays, sources: catalog, events }),
    );
    writeFileSync(join(OUT_DIR, "health.json"), JSON.stringify(summary, null, 2));
    const history = [...(await previousHistory()), historyEntry(summary)].slice(-HISTORY_LIMIT);
    writeFileSync(join(OUT_DIR, "history.json"), JSON.stringify(history));
    console.log(`\nWrote ${events.length} events to ${join(OUT_DIR, "events.json")} (history: ${history.length} runs)`);
  }

  // A run where nothing at all came back means the environment is broken
  // (network, a shared dependency…) — fail loudly rather than publish an empty site.
  if (summary.totals.events === 0 && selected.length > 1) {
    console.error("✗ No events from any source — refusing to publish an empty site.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Scrape crashed:", err);
  process.exit(1);
});
