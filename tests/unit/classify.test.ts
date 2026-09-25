import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyFree, classifyOnline, isInLondon, isOutsideLondon } from "../../scraper/core/classify.ts";

describe("classifyFree", () => {
  it("trusts a price field", () => {
    assert.equal(classifyFree({ priceText: "Free" }), true);
    assert.equal(classifyFree({ priceText: "£0.00" }), true);
    assert.equal(classifyFree({ priceText: "0.00 GBP" }), true);
    assert.equal(classifyFree({ priceText: "£15 / £9" }), false);
    assert.equal(classifyFree({ priceText: "Tickets from £12" }), false);
    assert.equal(classifyFree({ priceText: "Pay what you can" }), true);
  });
  it("treats members-only free entry as paid for the public", () => {
    assert.equal(classifyFree({ priceText: "Free for members, £10 non-members" }), false);
  });
  it("reads explicit prose but ignores incidental 'free'", () => {
    assert.equal(classifyFree({ texts: ["This event is free to attend, but booking is required."] }), true);
    assert.equal(classifyFree({ texts: ["Admission: free"] }), true);
    assert.equal(classifyFree({ texts: ["A talk about free speech and free will."] }), null);
    assert.equal(classifyFree({ texts: ["Standard tickets £15, concessions available"] }), false);
    assert.equal(classifyFree({}), null);
  });
});

describe("classifyOnline", () => {
  it("uses the location first; hybrid counts as in person", () => {
    assert.equal(classifyOnline({ location: "Online" }), true);
    assert.equal(classifyOnline({ location: "Zoom webinar" }), true);
    assert.equal(classifyOnline({ location: "Online event" }), true);
    assert.equal(classifyOnline({ location: "Conway Hall, 25 Red Lion Square" }), false);
    assert.equal(classifyOnline({ location: "Royal Geographical Society and online" }), false);
    assert.equal(classifyOnline({ location: "Victoria Hall / Online" }), false);
  });
  it("falls back to prose", () => {
    assert.equal(classifyOnline({ texts: ["This is an online event held on Zoom."] }), true);
    assert.equal(classifyOnline({ texts: ["A hybrid event: join us in person or online."] }), false);
    assert.equal(classifyOnline({ texts: ["Join us in person at the Academy."] }), false);
    assert.equal(classifyOnline({ texts: ["A lecture about the history of maps."] }), null);
  });
});

describe("London location checks", () => {
  it("recognises places outside London", () => {
    assert.equal(isOutsideLondon("Manchester Museum, Oxford Road"), true);
    assert.equal(isOutsideLondon("The Old Market, Brighton, BN3 1AS"), true);
    assert.equal(isOutsideLondon("Binks Hall, St John’s College Durham, Durham"), true);
  });
  it("does not trip over London streets named after towns", () => {
    assert.equal(isOutsideLondon("Oxford Street"), false);
    assert.equal(isOutsideLondon("Leicester Square"), false);
    assert.equal(isOutsideLondon("Liverpool Street station"), false);
    assert.equal(isOutsideLondon("Duke of York Square"), false);
    assert.equal(isOutsideLondon("Burlington House, Piccadilly, London W1J 0BE"), false);
    assert.equal(isOutsideLondon(null), false);
  });
  it("isInLondon needs positive evidence", () => {
    assert.equal(isInLondon("The Royal Institution, 21 Albemarle Street, W1S 4BS"), true);
    assert.equal(isInLondon("Imperial College London"), true);
    assert.equal(isInLondon("Harwell Campus, Didcot, OX11 0QX"), false);
    assert.equal(isInLondon("Maynooth University, County Kildare, Ireland"), false);
    assert.equal(isInLondon(""), false);
  });
});
