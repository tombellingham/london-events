import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanTitleWithStatus, isMembersOnly, normalizeEvent, splitFormatMarker } from "../../scraper/core/normalize.ts";
import { makeHorizon } from "../../scraper/core/runner.ts";
import type { RawEvent, Source } from "../../scraper/core/types.ts";

const horizon = makeHorizon(45, new Date("2026-09-25T09:00:00Z"));
const source: Source = { id: "test", name: "Test", homepage: "https://example.org", scrape: async () => [] };
const withDefaults: Source = { ...source, defaults: { free: true, location: "Test Hall, 1 Test Street, WC1E 7HU" } };

function raw(overrides: Partial<RawEvent> = {}): RawEvent {
  return { title: "A Talk About Maps", url: "https://example.org/events/maps", start: { date: "2026-10-01", time: "18:30" }, ...overrides };
}

describe("title clean-up", () => {
  it("strips status markers and reports cancellations", () => {
    assert.deepEqual(cleanTitleWithStatus("SOLD OUT: The Big Talk"), { title: "The Big Talk", cancelled: false });
    assert.deepEqual(cleanTitleWithStatus("The Big Talk *Sold Out*"), { title: "The Big Talk", cancelled: false });
    assert.equal(cleanTitleWithStatus("CANCELLED - The Big Talk").cancelled, true);
    assert.equal(cleanTitleWithStatus("The Cancelled Election of 1860").cancelled, false);
  });
  it("splits format markers", () => {
    assert.deepEqual(splitFormatMarker("In-Person Only: A Talk"), { title: "A Talk", online: false });
    assert.deepEqual(splitFormatMarker("A Talk [online]"), { title: "A Talk", online: true });
    assert.deepEqual(splitFormatMarker("Online Harms: A Talk"), { title: "Online Harms: A Talk", online: null });
  });
  it("detects members-only events", () => {
    assert.equal(isMembersOnly("Fellows' Evening", ""), true);
    assert.equal(isMembersOnly("Autumn Lecture", "This event is for members only."), true);
    assert.equal(isMembersOnly("Autumn Lecture", "Open to all; members get priority booking."), false);
  });
});

describe("normalizeEvent", () => {
  it("produces a complete record", () => {
    const result = normalizeEvent(raw({ description: "<p>Maps &amp; more</p>", priceText: "Free", location: "Room 1, Senate House, WC1E 7HU" }), source, horizon);
    assert.ok(result.ok);
    const e = result.event;
    assert.equal(e.title, "A Talk About Maps");
    assert.equal(e.date, "2026-10-01");
    assert.equal(e.time, "18:30");
    assert.equal(e.start, "2026-10-01T17:30:00.000Z");
    assert.equal(e.description, "Maps & more");
    assert.equal(e.free, true);
    assert.equal(e.online, false);
    assert.match(e.id, /^[0-9a-f]{12}$/);
  });
  it("accepts instants and converts them to London time", () => {
    const result = normalizeEvent(raw({ start: new Date("2026-10-26T19:00:00Z") }), source, horizon); // GMT by then
    assert.ok(result.ok);
    assert.equal(result.event.time, "19:00");
  });
  it("drops past, far-future, long-running, cancelled and invalid events", () => {
    const reason = (r: RawEvent) => {
      const res = normalizeEvent(r, source, horizon);
      return res.ok ? "ok" : res.reason;
    };
    assert.equal(reason(raw({ start: { date: "2026-09-24", time: null } })), "past");
    assert.equal(reason(raw({ start: { date: "2026-11-09", time: null } })), "beyond-horizon");
    assert.equal(reason(raw({ end: { date: "2026-12-01", time: null } })), "long-run");
    assert.equal(reason(raw({ title: "CANCELLED: A Talk About Maps" })), "cancelled");
    assert.equal(reason(raw({ url: "/relative" })), "invalid");
    assert.equal(reason(raw({ start: { date: "2026-02-30", time: null } })), "invalid");
  });
  it("keeps today's events and the last day of the horizon", () => {
    assert.ok(normalizeEvent(raw({ start: { date: "2026-09-25", time: "09:00" } }), source, horizon).ok);
    assert.ok(normalizeEvent(raw({ start: { date: "2026-11-08", time: null } }), source, horizon).ok);
  });
  it("drops in-person events outside London unless they can be joined online", () => {
    const away = normalizeEvent(raw({ location: "Assembly Rooms, Edinburgh" }), source, horizon);
    assert.equal(away.ok ? "ok" : away.reason, "outside-london");
    const streamed = normalizeEvent(raw({ location: "Assembly Rooms, Edinburgh", hints: ["Watch online via our livestream"] }), source, horizon);
    assert.ok(streamed.ok);
    assert.equal(streamed.event.online, true);
    assert.match(streamed.event.location ?? "", /livestream/);
  });
  it("applies source defaults and hybrid-as-in-person", () => {
    const d = normalizeEvent(raw(), withDefaults, horizon);
    assert.ok(d.ok);
    assert.equal(d.event.free, true);
    assert.equal(d.event.online, false);
    assert.equal(d.event.location, "Test Hall, 1 Test Street, WC1E 7HU");
    const hybrid = normalizeEvent(raw({ location: "Test Hall and online" }), source, horizon);
    assert.ok(hybrid.ok);
    assert.equal(hybrid.event.online, false);
    const online = normalizeEvent(raw({ title: "A Talk About Maps (Online)" }), withDefaults, horizon);
    assert.ok(online.ok);
    assert.equal(online.event.online, true);
    assert.equal(online.event.location, "Online");
  });
  it("respects a source's include filter", () => {
    const picky: Source = { ...source, include: (e) => !/maps/i.test(e.title) };
    const res = normalizeEvent(raw(), picky, horizon);
    assert.equal(res.ok ? "ok" : res.reason, "excluded");
  });
});
