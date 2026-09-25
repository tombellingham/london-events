import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addDays, fromLondon, inferYear, parseDate, parseDateTime, parseIsoAsLondonWallClock, parseIsoInstant, parseNaiveLondon, parseTime, toLondonDateTime } from "../../scraper/core/dates.ts";

const NOW = new Date("2026-09-25T12:00:00Z");

describe("fromLondon", () => {
  it("applies BST in summer and GMT in winter", () => {
    assert.equal(fromLondon("2026-09-28", "19:00").toISOString(), "2026-09-28T18:00:00.000Z");
    assert.equal(fromLondon("2026-12-01", "19:00").toISOString(), "2026-12-01T19:00:00.000Z");
  });
  it("handles the autumn change-over day", () => {
    // 25 Oct 2026: 01:30 happens twice; the first (BST) reading wins.
    assert.equal(fromLondon("2026-10-25", "01:30").toISOString(), "2026-10-25T00:30:00.000Z");
    assert.equal(fromLondon("2026-10-25", "12:00").toISOString(), "2026-10-25T12:00:00.000Z");
  });
  it("round-trips through toLondonDateTime", () => {
    for (const [date, time] of [["2026-03-29", "09:15"], ["2026-07-01", "23:59"], ["2027-01-01", "00:00"]] as const) {
      assert.deepEqual(toLondonDateTime(fromLondon(date, time)), { date, time });
    }
  });
});

describe("ISO helpers", () => {
  it("only trusts strings with an offset as instants", () => {
    assert.equal(parseIsoInstant("2026-09-28T19:00:00+01:00")?.toISOString(), "2026-09-28T18:00:00.000Z");
    assert.equal(parseIsoInstant("2026-09-28T19:00:00Z")?.toISOString(), "2026-09-28T19:00:00.000Z");
    assert.equal(parseIsoInstant("2026-09-28T19:00:00"), null);
  });
  it("reads naive and mislabelled timestamps as London wall-clock", () => {
    assert.deepEqual(parseNaiveLondon("2026-09-28 19:00:00"), { date: "2026-09-28", time: "19:00" });
    assert.deepEqual(parseNaiveLondon("2026-09-28"), { date: "2026-09-28", time: null });
    assert.deepEqual(parseIsoAsLondonWallClock("2026-11-10T19:00:00+00:00"), { date: "2026-11-10", time: "19:00" });
    assert.equal(parseNaiveLondon("2026-02-30"), null);
  });
});

describe("parseDate", () => {
  it("understands the common UK formats", () => {
    assert.equal(parseDate("Monday 28th September 2026"), "2026-09-28");
    assert.equal(parseDate("28/09/2026"), "2026-09-28");
    assert.equal(parseDate("September 28, 2026"), "2026-09-28");
    assert.equal(parseDate("Tue 6 Oct 2026, 6.30pm"), "2026-10-06");
    assert.equal(parseDate("2026-10-01T18:00"), "2026-10-01");
  });
  it("takes the first day of a range", () => {
    assert.equal(parseDate("28–29 September 2026"), "2026-09-28");
    assert.equal(parseDate("12-15 July 2027"), "2027-07-12");
    assert.equal(parseDate("28 September–2 October 2026"), "2026-09-28");
  });
  it("infers a missing year relative to now", () => {
    assert.equal(parseDate("Sept 28", NOW), "2026-09-28");
    assert.equal(parseDate("1 Aug", NOW), "2026-08-01"); // recent past stays this year
    assert.equal(parseDate("5 January", new Date("2026-12-15T12:00:00Z")), "2027-01-05");
    assert.equal(inferYear(3, 1, NOW), 2027);
  });
  it("returns null when there is no date", () => {
    assert.equal(parseDate("Date TBC"), null);
    assert.equal(parseDate("UK TOUR, Multiple Venues"), null);
  });
});

describe("parseTime", () => {
  const cases: Array<[string, string | null]> = [
    ["7pm", "19:00"],
    ["7.30pm–9pm", "19:30"],
    ["6.30-8pm", "18:30"],
    ["11-1pm", "11:00"],
    ["10.30am-12.30pm", "10:30"],
    ["19:30", "19:30"],
    ["07:30", "07:30"],
    ["7.30", "19:30"],
    ["12 noon", "12:00"],
    ["11am", "11:00"],
    ["Doors 6.30pm, talk 7pm", "19:00"],
    ["Tickets £7.50", null],
    ["Lasts 3.5 hours", null],
    ["2 hours", null],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${expected}`, () => assert.equal(parseTime(input), expected));
  }
});

describe("parseDateTime", () => {
  it("does not mistake the day of the month for a time", () => {
    assert.deepEqual(parseDateTime("Tue 6 Oct 2026, 6.30pm"), { date: "2026-10-06", time: "18:30" });
    assert.deepEqual(parseDateTime("28 Sep 2026 19:00 - 20:30"), { date: "2026-09-28", time: "19:00" });
    assert.deepEqual(parseDateTime("Mon 28 Sep 2026 7:00 PM - 8:30 PM"), { date: "2026-09-28", time: "19:00" });
    assert.deepEqual(parseDateTime("30/09/2026"), { date: "2026-09-30", time: null });
    assert.deepEqual(parseDateTime("2026-10-01T18:00:00"), { date: "2026-10-01", time: "18:00" });
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  });
});
