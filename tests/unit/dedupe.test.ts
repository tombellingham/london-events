import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dedupe, normalizeUrl, titleSimilarity } from "../../scraper/core/dedupe.ts";
import type { EventRecord } from "../../scraper/core/types.ts";

let n = 0;
function ev(overrides: Partial<EventRecord>): EventRecord {
  n++;
  return {
    id: `id${n}`,
    source: "a",
    title: "The Secret Life of Sewers",
    url: `https://example.org/e/${n}`,
    date: "2026-10-13",
    time: "18:30",
    start: "2026-10-13T17:30:00.000Z",
    location: "The British Academy, Carlton House Terrace",
    description: null,
    speakers: [],
    free: null,
    online: null,
    price: null,
    ...overrides,
  };
}

describe("normalizeUrl", () => {
  it("ignores tracking parameters, fragments, case, www and trailing slashes", () => {
    assert.equal(normalizeUrl("https://www.Example.org/Events/Talk/?utm_source=x&id=2#top"), normalizeUrl("http://example.org/events/talk?id=2"));
    assert.notEqual(normalizeUrl("https://example.org/e?id=1"), normalizeUrl("https://example.org/e?id=2"));
  });
});

describe("dedupe", () => {
  it("merges the same URL on the same day, keeping the richer record", () => {
    const a = ev({ url: "https://example.org/talk?utm_medium=email", description: null });
    const b = ev({ url: "https://www.example.org/talk/", description: "A long description of the talk that is useful." });
    const { events, exactDuplicates } = dedupe([a, b]);
    assert.equal(exactDuplicates, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].description, "A long description of the talk that is useful.");
  });
  it("keeps recurring events that share a URL on different days", () => {
    const { events } = dedupe([ev({ url: "https://example.org/series" }), ev({ url: "https://example.org/series", date: "2026-10-20", start: "2026-10-20T17:30:00.000Z" })]);
    assert.equal(events.length, 2);
  });
  it("merges the same event listed by two sources and remembers the other listing", () => {
    const a = ev({ source: "a", title: "The secret life of sewers", speakers: ["Rosemary Ashton"] });
    const b = ev({ source: "b", title: "The Secret Life of Sewers: a panel discussion", time: "18:45" });
    const { events, crossSourceDuplicates } = dedupe([a, b]);
    assert.equal(crossSourceDuplicates, 1);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].alsoAt?.map((x) => x.source), ["b"]);
  });
  it("does not merge similar titles at different venues or times", () => {
    assert.equal(dedupe([ev({ source: "a" }), ev({ source: "b", location: "Conway Hall, Red Lion Square" })]).events.length, 2);
    assert.equal(dedupe([ev({ source: "a" }), ev({ source: "b", time: "10:00" })]).events.length, 2);
  });
  it("merges one source's syndicated copies only when title and time match exactly", () => {
    assert.equal(dedupe([ev({}), ev({})]).events.length, 1);
    assert.equal(dedupe([ev({}), ev({ time: "18:45" })]).events.length, 2);
  });
  it("sorts by start time", () => {
    const { events } = dedupe([ev({ title: "Later talk on rivers", start: "2026-10-13T19:00:00.000Z", time: "20:00" }), ev({ title: "Earlier talk on hills", start: "2026-10-13T08:00:00.000Z", time: "09:00" })]);
    assert.deepEqual(events.map((e) => e.time), ["09:00", "20:00"]);
  });
});

describe("titleSimilarity", () => {
  it("scores containment highly and unrelated titles low", () => {
    assert.ok(titleSimilarity("Unveiling Vermeer", "Unveiling Vermeer: The Man and his Masterpieces") < 0.8); // too short to trust containment
    assert.ok(titleSimilarity("The Man and his Masterpieces of Vermeer", "Vermeer: The Man and his Masterpieces, with Andrew Graham-Dixon") >= 0.8);
    assert.ok(titleSimilarity("A history of maps", "The chemistry of bread") < 0.2);
  });
});
