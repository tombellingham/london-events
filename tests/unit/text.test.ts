import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanName, honorificNames, htmlToText, labelled, htmlToLines, speakersFromTitle, splitNames, truncate, uniqNames, unshout } from "../../scraper/core/text.ts";

describe("speakers", () => {
  it("reads conversational titles", () => {
    assert.deepEqual(speakersFromTitle("Richard Dawkins in conversation with Alice Roberts"), ["Richard Dawkins", "Alice Roberts"]);
    assert.deepEqual(speakersFromTitle("Lubaina Himid in conversation"), ["Lubaina Himid"]);
    assert.deepEqual(speakersFromTitle("An evening with Mary Beard"), ["Mary Beard"]);
  });
  it("only trusts positional guesses that look like people", () => {
    assert.deepEqual(speakersFromTitle("Jane Doe: A Title"), ["Jane Doe"]);
    assert.deepEqual(speakersFromTitle("Slow Looking: Title"), []);
    assert.deepEqual(speakersFromTitle("Digital Heists Uncovered: How Crime Went Online"), []);
    assert.deepEqual(speakersFromTitle("Walk: William Tyndale"), []); // the subject, not the guide
    assert.deepEqual(speakersFromTitle("Inaugural Lecture: Professor Rajvinder Karda"), ["Professor Rajvinder Karda"]);
    assert.deepEqual(speakersFromTitle("Finance Seminar – Dorje Brody"), ["Dorje Brody"]);
  });
  it("finds honorific names in prose", () => {
    assert.deepEqual(honorificNames("Chaired by Dr Amina Patel, with Prof. Tom Jones OBE"), ["Dr Amina Patel", "Prof. Tom Jones"]);
    assert.deepEqual(speakersFromTitle("The Future of Cities", "A lecture by Professor Jane Smith FRS on urban life."), ["Professor Jane Smith"]);
  });
  it("normalises and de-duplicates names", () => {
    assert.equal(cleanName("Professor Sir David Attenborough OM FRS"), "Professor Sir David Attenborough");
    assert.deepEqual(uniqNames(["Ben Okri", "Rosemary Clunie", "Sir Ben Okri"]), ["Sir Ben Okri", "Rosemary Clunie"]);
    assert.deepEqual(uniqNames(["Mary Beard", "mary beard", "Professor Mary Beard FBA"]), ["Professor Mary Beard"]);
    assert.deepEqual(splitNames("Jane Doe, John Smith and Ada Lovelace"), ["Jane Doe", "John Smith", "Ada Lovelace"]);
  });
});

describe("text helpers", () => {
  it("converts HTML to text", () => {
    assert.equal(htmlToText("<p>Hello&nbsp;<b>world</b></p><p>Second</p>"), "Hello world Second");
    assert.deepEqual(htmlToLines("<p>Date: Monday</p><p>Venue:</p><p>The Bell</p>"), ["Date: Monday", "Venue:", "The Bell"]);
    assert.equal(labelled(htmlToLines("<p>Date: Monday</p><p>Venue:</p><p>The Bell</p>"), /venue/i), "The Bell");
  });
  it("truncates on a word boundary", () => {
    assert.equal(truncate("one two three four five six", 15), "one two three…");
  });
  it("tames SHOUTY titles only", () => {
    assert.equal(unshout("THE BIG DEBATE: WHO OWNS THE SEA?"), "The Big Debate: Who Owns The Sea?");
    assert.equal(unshout("UCL Lunch Hour Lecture"), "UCL Lunch Hour Lecture");
  });
});
