import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Event } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRAPERS_DIR = join(__dirname, "scrapers");

export interface Adapter {
  name: string;
  scrape: () => Promise<Event[]>;
}

export interface AdapterResult {
  name: string;
  events: Event[];
  error: string | null;
}

interface ScraperModule {
  scrape: () => Promise<Event[]>;
  name?: string;
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
export async function loadAdapters(): Promise<Adapter[]> {
  const files = readdirSync(SCRAPERS_DIR).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !f.endsWith(".test.ts")
  );

  const adapters: Adapter[] = [];

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

/**
 * Runs a single adapter, isolating failures so one broken site doesn't
 * take down the whole build.
 */
export async function runAdapter(adapter: Adapter): Promise<AdapterResult> {
  try {
    const events = await adapter.scrape();
    return { name: adapter.name, events, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { name: adapter.name, events: [], error: message };
  }
}

/**
 * Loads and runs every adapter, in parallel, with per-adapter isolation.
 */
export async function runAllAdapters(): Promise<AdapterResult[]> {
  const adapters = await loadAdapters();
  return Promise.all(adapters.map(runAdapter));
}