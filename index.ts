import type { Event } from "./types";
import { runAllAdapters } from "./adapters";

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
  const results = await runAllAdapters();

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
    printEvent(result.events[0]);
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
  console.error("Runner crashed:", err);
  process.exit(1);
});