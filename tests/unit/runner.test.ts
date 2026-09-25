import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runSources } from "../../scraper/core/runner.ts";
import { eventId } from "../../scraper/core/normalize.ts";
import { fromLondon } from "../../scraper/core/dates.ts";
import type { EventRecord, Source, SourceSnapshot } from "../../scraper/core/types.ts";

const now = new Date("2026-09-25T09:00:00Z");

function record(source: string, date: string, title: string, extra: Partial<EventRecord> = {}): EventRecord {
  const url = `https://${source}.example/${encodeURIComponent(title)}`;
  return {
    id: eventId(source, url, date, "19:00"),
    source,
    title,
    url,
    date,
    time: "19:00",
    start: fromLondon(date, "19:00").toISOString(),
    location: "Senate House, Malet Street, WC1E 7HU",
    description: null,
    speakers: [],
    free: true,
    online: false,
    price: null,
    ...extra,
  };
}

const working: Source = {
  id: "working",
  name: "Working",
  homepage: "https://working.example",
  scrape: async () => [{ title: "A fresh talk", url: "https://working.example/fresh", start: { date: "2026-10-01", time: "18:00" }, location: "Senate House, WC1E 7HU" }],
};
const broken = (id: string): Source => ({
  id,
  name: id,
  homepage: `https://${id}.example`,
  scrape: async () => {
    throw new Error("Blocked by Cloudflare");
  },
});

const snapshot = (id: string, scrapedAt: string, events: EventRecord[]): SourceSnapshot => ({ id, scrapedAt, events });

describe("runSources: falling back on the last good scrape", () => {
  it("shows a failed source's still-listable events from its last good run", async () => {
    const previous = snapshot("flaky", "2026-09-23T04:30:00.000Z", [
      record("flaky", "2026-09-20", "Already happened"),
      record("flaky", "2026-09-30", "Still to come", { alsoAt: [{ source: "working", url: "https://working.example/x" }] }),
      record("flaky", "2026-10-02", "Watch from home", { online: true, location: "Online" }),
      record("flaky", "2026-10-03", "Autumn Exhibition"),
    ]);
    const { events, summary, snapshots } = await runSources([working, broken("flaky")], {
      horizonDays: 45,
      now,
      quiet: true,
      retryBlocked: false,
      lastGood: async (s) => (s.id === "flaky" ? previous : null),
    });
    const flaky = summary.sources.find((s) => s.id === "flaky")!;
    assert.equal(flaky.status, "error");
    assert.equal(flaky.carried, 1);
    assert.equal(flaky.count, 1);
    assert.equal(flaky.lastOkAt, previous.scrapedAt);
    assert.equal(summary.totals.failed, 1);
    const carried = events.find((e) => e.source === "flaky")!;
    assert.equal(carried.title, "Still to come");
    assert.equal(carried.alsoAt, undefined);
    // The last good scrape is republished as-is, so the fallback survives another bad day.
    assert.deepEqual(snapshots.find((s) => s.id === "flaky"), previous);

    const fresh = snapshots.find((s) => s.id === "working")!;
    assert.equal(fresh.events.length, 1);
    assert.equal(summary.sources.find((s) => s.id === "working")!.lastOkAt, fresh.scrapedAt);
  });

  it("stops standing in after a week", async () => {
    const stale = snapshot("gone", "2026-09-17T04:30:00.000Z", [record("gone", "2026-09-30", "Still to come")]);
    const { events, summary, snapshots } = await runSources([broken("gone")], {
      horizonDays: 45,
      now,
      quiet: true,
      retryBlocked: false,
      lastGood: async () => stale,
    });
    assert.equal(events.length, 0);
    assert.equal(summary.sources[0].carried, 0);
    assert.equal(summary.sources[0].lastOkAt, stale.scrapedAt);
    assert.deepEqual(snapshots, [stale]);
  });

  it("publishes nothing for a source that has never worked", async () => {
    const { snapshots, summary } = await runSources([broken("never")], { horizonDays: 45, now, quiet: true, retryBlocked: false, lastGood: async () => null });
    assert.deepEqual(snapshots, []);
    assert.equal(summary.sources[0].lastOkAt, null);
  });
});
