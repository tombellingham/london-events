import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sources } from "../../scraper/sources/index.ts";
import { parseSouthbankDates } from "../../scraper/sources/southbank.ts";
import { pokDescription, pokEventPage, pokFeedEvents, type MapFeed } from "../../scraper/sources/pints-of-knowledge.ts";
import { readFileSync } from "node:fs";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("source registry", () => {
  it("has 32 sources with unique, URL-safe ids", () => {
    assert.equal(sources.length, 32);
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
  it("Pints of Knowledge: talks from the venue map feed (published only)", () => {
    const events = pokFeedEvents(JSON.parse(fixture("pok-map.json")) as MapFeed);
    assert.deepEqual(
      events.map((e) => [e.title, e.start, e.location, e.url]),
      [
        ["“Lessons from the Wild Side: What Strange Animals Teach us About Understanding Human Disease”", { date: "2026-10-11", time: "12:00" }, "BOX Piccadilly, 21-23 Shaftesbury Ave, London W1D 7EF", "https://www.tickettailor.com/events/pintsofknowledge/2383086"],
        ["“A Physicist's Guide to Simulating the Universe”", { date: "2026-09-28", time: "19:00" }, "Swingers West End, 15 John Prince's St, London W1G 0JW", "https://www.tickettailor.com/events/pintsofknowledge/2339821"],
      ],
    );
  });
  it("Pints of Knowledge: the whole description from the event page, without the venue and FAQs", () => {
    const page = pokEventPage(fixture("pok-event.html"), "100 Facts You Probably Didn't Know About London");
    assert.match(page.description!, /^For the last 15 years, Jonnie Fielding \(better known as 'Bowl of Chalk'\) a dedicated/);
    assert.match(page.description!, /why Downing Street is Painted Black\.$/);
    assert.deepEqual(page.speakers, ["Jonnie Fielding"]);
    assert.equal(page.start?.toISOString(), "2026-09-28T18:00:00.000Z");
  });
  it("Pints of Knowledge: descriptions lose the repeated title and speakers", () => {
    const cases: Array<[string, string, string, string[]]> = [
      ["When to Quit?", '"When to Quit?"with Anthony KlotzDetails: Anthony Klotz predicted…', "Anthony Klotz predicted…", ["Anthony Klotz"]],
      ["How to Win 'The Traitors' with Aristotle", `"How to Win 'The Traitors' with Aristotle"with Alexander SergeantSummary: The Traitors has…`, "The Traitors has…", ["Alexander Sergeant"]],
      ['“I Vant to Suck Your Blood”: The Eternal Appeal of Vampires."', "“I vant to suck your blood”: The eternal appeal of vampires With Dr Kaja Franck SummaryFor centuries, vampires…", "For centuries, vampires…", ["Dr Kaja Franck"]],
      // The heading needn't match the listed title.
      ["The Carbon Story Hiding in Your Local Pub", '"The Carbon Story Hiding in Your Local" with Will Arnold (Arup) Summary: Look around…', "Look around…", ["Will Arnold"]],
      ["The Pub", '"The Pub" with Sivamohan Valluvan and Amit Singh Summary: Amit Singh, …', "Amit Singh, …", ["Sivamohan Valluvan", "Amit Singh"]],
      ['BOOK CLUB: "Stalin’s Apostles" with Antonia Senior', "📚BOOK CLUB: Stalin’s Apostles with Antonia Senior For this debut book club…", "For this debut book club…", []],
      ["Maps", "A talk about maps. Details: to follow.", "A talk about maps. Details: to follow.", []],
      ["Maps", '"Brilliant" – The Times. Join us for…', '"Brilliant" – The Times. Join us for…', []],
      // Venue details before the label don't cut the description short.
      ["Maps", '"Maps" with Jo Bloggs Venue: The Pub Summary: A talk. Venue: The Pub, E1 6JJ FAQs: …', "A talk.", ["Jo Bloggs"]],
    ];
    for (const [title, text, description, speakers] of cases) assert.deepEqual(pokDescription(text, title), { description, speakers }, text);
  });
});
