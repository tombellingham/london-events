import { scrape } from "./scrapers/gresham";

async function main() {
  console.log("Scraping Gresham College...");
  const events = await scrape();

  console.log(`\nFound ${events.length} events\n`);

  // Print the first few in full, so you can eyeball date parsing and the
  // synthetic description without flooding the terminal.
  for (const event of events.slice(0, 5)) {
    console.log("──────────────────────────────────────");
    console.log("Title:      ", event.title);
    console.log("Description:", event.description);
    console.log("Start:      ", event.startDate.toISOString(), "(local:", event.startDate.toString() + ")");
    console.log("End:        ", event.endDate?.toISOString() ?? "(none)");
    console.log("URL:        ", event.url);
    console.log("Source:     ", event.source);
  }

  if (events.length > 5) {
    console.log(`\n...and ${events.length - 5} more`);
  }

  // Sanity checks worth eyeballing manually rather than asserting on,
  // since this is a manual smoke test, not a unit test suite.
  const undated = events.filter((e) => Number.isNaN(e.startDate.getTime()));
  if (undated.length > 0) {
    console.warn(`\n⚠ ${undated.length} events had unparseable dates`);
  }
}

main().catch((err) => {
  console.error("Scrape failed:", err);
  process.exit(1);
});