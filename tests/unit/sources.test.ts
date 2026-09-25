import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sources } from "../../scraper/sources/index.ts";
import { parseSouthbankDates } from "../../scraper/sources/southbank.ts";
import { pokSpeakers } from "../../scraper/sources/pints-of-knowledge.ts";
import { readFileSync } from "node:fs";
import { sasDetails, sasTeaser } from "../../scraper/sources/sas.ts";
import { baApiEvent, baDetails } from "../../scraper/sources/british-academy.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

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
  it("SAS: event page details", () => {
    const d = sasDetails(fixture("sas-event.html"));
    assert.equal(d.time, "16:30");
    assert.equal(d.location, "Hybrid: Online & Room 261, Second Floor, Senate House, Malet Street, London WC1E 7HU");
    assert.deepEqual(d.speakers, ["Celia Sánchez Natalías"]);
    assert.equal(d.type, "Seminar");
    assert.match(d.description ?? "", /^The collection of defixiones from Roman Carthage/);
  });
  it("British Academy: API results (series pages skipped) and event pages", () => {
    const api = JSON.parse(fixture("ba-api.json")) as { results: Parameters<typeof baApiEvent>[0][] };
    const events = api.results.map(baApiEvent);
    assert.equal(events[0], null); // "Searching for wellness" is a series
    assert.equal(events[1]?.location, "Square One, Coventry University, The Hub, 4 Jordan Well, Coventry, CV1 5QT");
    assert.equal(events[1]?.free, true);
    const sewers = events[2]!;
    assert.deepEqual(sewers.start, { date: "2026-10-13", time: null });
    const detailed = baDetails({ ...sewers, url: "https://www.thebritishacademy.ac.uk/x", start: { date: "2026-10-20", time: null } }, fixture("ba-event.html"));
    assert.deepEqual(detailed.start, { date: "2026-10-20", time: "18:30" });
    assert.equal(detailed.location, "The British Academy, 10-11 Carlton House Terrace, London, SW1Y 5AH");
    assert.equal(detailed.priceText, "Free");
    assert.deepEqual(detailed.speakers, ["Professor Sophie Harman", "Dr Annabel Sowemimo"]);
    assert.match(String(detailed.hints?.[0]), /Online and in person/);
  });
});
