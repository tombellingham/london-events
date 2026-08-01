import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Event } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRAPERS_DIR = join(__dirname, "scrapers");

interface ScraperModule {
  scrape: () => Promise<Event[]>;
  name?: string;
}

interface AdapterResult {
  name: string;
  events: Event[];
  error: string | null;
}

/**
 * Loads every adapter module from scrapers/ automatically — adding a new
 * scraper is just "drop a file in scrapers/", nothing here needs editing.
 *
 * Conventions each adapter module must follow:
 *   - export an async `scrape(): Promise<Event[]>`
 *   - export a `name: string` for display (falls back to the filename if
 *     omitted, so this won't hard-fail on a module that forgets it)
 */
async function loadAdapters(): Promise<
  Array<{ name: string; scrape: () => Promise<Event[]> }>
> {
  const files = readdirSync(SCRAPERS_DIR).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !f.endsWith(".test.ts")
  );

  const adapters: Array<{ name: string; scrape: () => Promise<Event[]> }> = [];

  for (const file of files) {
    const fullPath = join(SCRAPERS_DIR, file);
    const mod = (await import(pathToFileURL(fullPath).href)) as ScraperModule;

    if (typeof mod.scrape !== "function") {
      console.warn(`⚠ Skipping ${file}: no exported scrape() function`);
      continue;
    }

    adapters.push({
      name: mod.name ?? file.replace(/\.ts$/, ""),
      scrape: mod.scrape,
    });
  }

  return adapters;
}

async function runAdapter(adapter: {
  name: string;
  scrape: () => Promise<Event[]>;
}): Promise<AdapterResult> {
  try {
    const events = await adapter.scrape();
    return { name: adapter.name, events, error: null };
  } catch (err) {
    // Isolate failures per-adapter so one broken site doesn't take down the
    // whole build.
    const message = err instanceof Error ? err.message : String(err);
    return { name: adapter.name, events: [], error: message };
  }
}

function printEvent(event: Event, indent = "  ") {
  console.log(`${indent}Title:       ${event.title}`);
  console.log(`${indent}Description: ${truncate(event.description, 100)}`);
  console.log(`${indent}Start:       ${event.startDate.toISOString()}`);
  console.log(
    `${indent}End:         ${event.endDate?.toISOString() ?? "(none)"}`
  );
  console.log(`${indent}URL:         ${event.url}`);
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

async function main() {
  const adapters = await loadAdapters();
  console.log(
    `Discovered ${adapters.length} adapter(s): ${adapters
      .map((a) => a.name)
      .join(", ")}\n`
  );

  const results = await Promise.all(adapters.map(runAdapter));

  console.log("── Summary ──────────────────────────────");
  for (const result of results) {
    const status = result.error ? `FAILED (${result.error})` : "ok";
    console.log(
      `${result.name.padEnd(20)} ${String(result.events.length).padStart(
        4
      )} events   ${status}`
    );
  }

  console.log("\n── Example event per scraper ────────────");
  for (const result of results) {
    console.log(`\n${result.name}:`);
    if (result.error) {
      console.log(`  (skipped — adapter failed: ${result.error})`);
      continue;
    }
    if (result.events.length === 0) {
      console.log("  (no events found)");
      continue;
    }
    for (var i = 0; i < Math.min(5, result.events.length); i++) {
      printEvent(result.events[i], "    ");
    }
  }

  const totalEvents = results.reduce((sum, r) => sum + r.events.length, 0);
  const failedAdapters = results.filter((r) => r.error);

  console.log(`\nTotal events scraped: ${totalEvents}`);
  if (failedAdapters.length > 0) {
    console.log(
      `⚠ ${failedAdapters.length} adapter(s) failed: ${failedAdapters
        .map((r) => r.name)
        .join(", ")}`
    );
  }
}

main().catch((err) => {
  console.error("Aggregator crashed:", err);
  process.exit(1);
});