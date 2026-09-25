import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanTitleWithStatus, isExhibitionOrCourse, isMembersOnly, normalizeEvent, splitFormatMarker } from "../../scraper/core/normalize.ts";
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
    assert.equal(isMembersOnly("Friends of RAS (only): Early galaxies", ""), true);
    assert.equal(isMembersOnly("Members only: curator tour", ""), true);
    assert.equal(isMembersOnly("Autumn Lecture", "This event is for members only."), true);
    assert.equal(isMembersOnly("Autumn Lecture", "Open to all; members get priority booking."), false);
  });
  it("spots exhibitions and courses, but not talks about them", () => {
    assert.equal(isExhibitionOrCourse("Bringing It Home Exhibition"), true);
    assert.equal(isExhibitionOrCourse("The Science of Stress: A 4-week course"), true);
    assert.equal(isExhibitionOrCourse("Frida: The Making of an Icon: Exhibition Talk"), false);
    assert.equal(isExhibitionOrCourse("Stolen! Theft in the archive: exhibition launch and lecture"), false);
    assert.equal(isExhibitionOrCourse("A crash course in climate science"), false);
    assert.equal(isExhibitionOrCourse("The Course of Empire"), false);
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
  it("treats a midnight start as 'no time given'", () => {
    const result = normalizeEvent(raw({ start: { date: "2026-10-12", time: "00:00" } }), source, horizon);
    assert.ok(result.ok);
    assert.equal(result.event.time, null);
  });
  it("accepts instants and converts them to London time", () => {
    const result = normalizeEvent(raw({ start: new Date("2026-10-26T19:00:00Z") }), source, horizon); // GMT by then
    assert.ok(result.ok);
    assert.equal(result.event.time, "19:00");
  });
  it("drops past, far-future, week-plus runs, exhibitions, cancelled and invalid events", () => {
    const reason = (r: RawEvent) => {
      const res = normalizeEvent(r, source, horizon);
      return res.ok ? "ok" : res.reason;
    };
    assert.equal(reason(raw({ start: { date: "2026-09-24", time: null } })), "past");
    assert.equal(reason(raw({ start: { date: "2026-11-09", time: null } })), "beyond-horizon");
    assert.equal(reason(raw({ end: { date: "2026-12-01", time: null } })), "long-run");
    assert.equal(reason(raw({ end: { date: "2026-10-07", time: null } })), "ok"); // a 7-day conference
    assert.equal(reason(raw({ end: { date: "2026-10-08", time: null } })), "long-run"); // 8 days
    assert.equal(reason(raw({ title: "Autumn Exhibition" })), "not-a-talk");
    assert.equal(reason(raw({ title: "CANCELLED: A Talk About Maps" })), "cancelled");
    assert.equal(reason(raw({ url: "/relative" })), "invalid");
    assert.equal(reason(raw({ start: { date: "2026-02-30", time: null } })), "invalid");
  });
  it("keeps today's events and the last day of the horizon", () => {
    assert.ok(normalizeEvent(raw({ start: { date: "2026-09-25", time: "09:00" } }), source, horizon).ok);
    assert.ok(normalizeEvent(raw({ start: { date: "2026-11-08", time: null } }), source, horizon).ok);
  });
  it("keeps in-person London events only", () => {
    const reason = (r: RawEvent, s: Source = source) => {
      const res = normalizeEvent(r, s, horizon);
      return res.ok ? "ok" : res.reason;
    };
    assert.equal(reason(raw({ location: "Assembly Rooms, Edinburgh" })), "outside-london");
    assert.equal(reason(raw({ location: "Assembly Rooms, Edinburgh", hints: ["Watch online via our livestream"] })), "outside-london");
    assert.equal(reason(raw({ location: "Online" })), "online-only");
    assert.equal(reason(raw({ title: "A Talk About Maps (Online)" }), withDefaults), "online-only");
    assert.equal(reason(raw({ online: true, location: "Senate House, WC1E 7HU" })), "online-only");
    assert.equal(reason(raw({ description: "This is an online event, held on Zoom." })), "online-only");
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
    const streamed = normalizeEvent(raw({ location: "Test Hall", description: "Join us in person or via the livestream." }), source, horizon);
    assert.ok(streamed.ok);
    assert.equal(streamed.event.online, false);
  });
  it("respects a source's include filter", () => {
    const picky: Source = { ...source, include: (e) => !/maps/i.test(e.title) };
    const res = normalizeEvent(raw(), picky, horizon);
    assert.equal(res.ok ? "ok" : res.reason, "excluded");
  });
});
