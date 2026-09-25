import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sources } from "../../scraper/sources/index.ts";
import { parseSouthbankDates } from "../../scraper/sources/southbank.ts";
import { pokSpeakers } from "../../scraper/sources/pints-of-knowledge.ts";
import { readFileSync } from "node:fs";
import { sasDetails, sasTeaser } from "../../scraper/sources/sas.ts";

describe("source registry", () => {
  it("has 35 sources with unique, URL-safe ids", () => {
    assert.equal(sources.length, 35);
    const ids = sources.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
  it("gives every source a name and an https homepage", () => {
    for (const s of sources) {
      assert.ok(s.name.trim(), s.id);
      assert.match(s.homepage, /^https:\/\//, s.id);
    }
  });
});

describe("source-specific parsers", () => {
  it("Southbank: one entry per date, sharing year and time", () => {
    const now = new Date("2026-09-25T12:00:00Z");
    assert.deepEqual(parseSouthbankDates("Sat 3 Oct 2026, 7.45pm", now), [{ date: "2026-10-03", time: "19:45" }]);
    assert.deepEqual(parseSouthbankDates("Fri 4 Sep & Sat 5 Sep 2027, 7.30pm", now), [
      { date: "2027-09-04", time: "19:30" },
      { date: "2027-09-05", time: "19:30" },
    ]);
  });
  it("Pints of Knowledge: speaker from the 'With …' line", () => {
    assert.deepEqual(pokSpeakers('"100 Facts About London"With Jonnie Fielding (Bowl of Chalk)\nDetails: …'), ["Jonnie Fielding"]);
    assert.deepEqual(pokSpeakers("No speaker line here"), []);
  });
  it("SAS: teasers from the listing API", () => {
    const teaser = sasTeaser(readFileSync(new URL("./fixtures/sas-teaser.html", import.meta.url), "utf8"));
    assert.deepEqual(teaser, {
      title: "CALL FOR PAPERS - Society for Renaissance Studies 12th Biennial Conference",
      url: "https://www.sas.ac.uk/news-events/events/call-papers-society-renaissance-studies-12th-biennial-conference",
      start: { date: "2026-05-01", time: null },
      end: { date: "2026-09-25", time: null },
      organiser: "The Warburg Institute",
    });
  });
  it("SAS: event page details from labelled fields", () => {
    const d = sasDetails(
      '<html><head><meta name="description" content="A lecture on archives."></head><body><main><dl><dt>Date</dt><dd>2 October 2026</dd><dt>Time</dt><dd>17:30 - 19:00</dd><dt>Venue</dt><dd>Room 349, Senate House</dd></dl></main></body></html>',
    );
    assert.equal(d.time, "17:30");
    assert.equal(d.location, "Room 349, Senate House");
    assert.equal(d.description, "A lecture on archives.");
  });
});
