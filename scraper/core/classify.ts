/**
 * Heuristic classifiers for the two facets every event gets:
 *   free  — true (free to the public), false (paid), null (can't tell)
 *   online — true (online only), false (in person, *including hybrid*), null
 *
 * Scrapers pass whatever they have: a dedicated price field is trusted far
 * more than prose, because descriptions mention "free speech", "free will",
 * "carbon-free"… so prose only counts when it says free *entry/admission/etc*.
 */

import { clean } from "./text.ts";

const DONATION = /\b(?:pay what you (?:can|wish|want|feel|decide)|pwyc|suggested donation|donations? (?:welcome|encouraged|optional|appreciated)|by donation|free,? donations)\b/i;
const PAID_PRICE = /[£$€]\s*[1-9]\d*(?:\.\d{2})?|[£$€]\s*0\.(?:[1-9]\d|0[1-9])|\b[1-9]\d*(?:\.\d{2})?\s*(?:gbp|pounds?)\b|\btickets? from\b|\bconcessions?\b/i;
const MEMBERS_ONLY_FREE = /\bfree\s+(?:for|to)\s+(?:members|fellows|friends|students|staff|subscribers|patrons)\b/i;

const FREE_PROSE = [
  /\bfree\s+(?:to\s+(?:attend|join|all|the\s+public)|entry|admission|event|talk|lecture|public\s+(?:event|lecture|talk)|of\s+charge|and\s+open\s+to\s+(?:all|the\s+public)|for\s+(?:all|everyone|the\s+public)|tickets?|registration|places?|webinar|online\s+(?:event|talk|lecture)|but\s+(?:booking|registration|ticketed))\b/i,
  /\b(?:entry|admission|tickets?|attendance|registration|this\s+(?:event|talk|lecture|webinar|session|seminar)\s+is|it'?s|events?\s+(?:is|are))\s*(?:is\s+|are\s+)?(?::|-|–)?\s*(?:completely\s+|totally\s+|entirely\s+)?free\b/i,
  /\ball\s+(?:welcome|are\s+welcome)[^.]{0,40}\bfree\b|\bfree\b[^.]{0,20}\ball\s+welcome\b/i,
  /^free\b/i,
];

const PAID_PROSE =
  /\bconcession(?:ary)?\s+(?:tickets?|rates?|prices?)\b|\b(?:buy|purchase)\s+(?:a|your|the)\s+(?:\w+\s+)?tickets?\b|\btickets?\s*(?:cost|are|:)?\s*£\s*[1-9]|£\s*[1-9]\d*(?:\.\d{2})?\s*(?:per\s+(?:person|ticket)|\(|standard|full|adult|concession|members?|non-members?|students?|general|\/|online|in[\s-]person)|\bstandard tickets?\b|\bticket prices?\b|\bprice:\s*£|\btickets?\s+(?:are\s+)?(?:priced|from)\s+£/i;

export interface FreeInput {
  priceText?: string | null;
  texts?: Array<string | null | undefined>;
}

/** true = free to attend (incl. pay-what-you-can), false = paid, null = unknown. */
export function classifyFree({ priceText, texts = [] }: FreeInput): boolean | null {
  const price = clean(priceText);
  if (price) {
    if (DONATION.test(price)) return true;
    // "Free for members, £10 non-members" → the public pays.
    if (MEMBERS_ONLY_FREE.test(price) && PAID_PRICE.test(price)) return false;
    // "Free", "£0", "0.00 GBP", "Free – £25" (a free ticket tier exists).
    if (/^\s*(?:free\b|£\s*0(?:\.00)?\b|0(?:\.00)?\s*(?:gbp)?\s*(?:$|[-–—]))/i.test(price)) return true;
    if (/\bfree\b/i.test(price) && !PAID_PRICE.test(price)) return true;
    if (PAID_PRICE.test(price)) return false;
  }

  const prose = texts.map(clean).filter(Boolean).join(" \n ");
  if (!prose) return null;
  if (DONATION.test(prose) && !PAID_PROSE.test(prose)) return true;
  const saysFree = FREE_PROSE.some((re) => re.test(prose));
  const saysPaid = PAID_PROSE.test(prose);
  if (saysFree && !saysPaid) return true;
  if (saysPaid && !saysFree) return false;
  if (saysFree && saysPaid) return MEMBERS_ONLY_FREE.test(prose) ? false : null;
  return null;
}

// ---------------------------------------------------------------------------

const ONLINE_WORDS =
  /\b(?:online|on-line|virtual(?:ly)?|zoom|microsoft\s+teams|teams|webinar|live[\s-]?stream(?:ed|ing)?|streamed|youtube|vimeo|crowdcast|remote(?:ly)?|digital)\b|\bhow\s*to\s*\+/gi;
const FILLER_WORDS =
  /\b(?:this|the|a|an|event|events|session|sessions|will|be|is|are|take|takes|taking|place|held|hosted|only|via|on|in|at|by|from|and|or|public|lecture|lectures|talk|talks|seminar|seminars|meeting|platform|format|delivered|join|us|live|details|link|links|sent|to|attendees|registered|after|registration|booking|you|your|access|watch|available|tba|tbc)\b/gi;
const HYBRID_LOC =
  /\b(?:and|&|\+|or|plus)\s+(?:online|livestream|live\s*stream|zoom|virtual)|(?:online|livestream|virtual)\s+(?:and|&|\+|or)\s+|\b(?:in[\s-]person|hybrid)\b/i;

const ONLINE_PROSE = [
  /\bonline[\s-]only\b/i,
  /\b(?:this|the)\s+(?:is\s+an?\s+)?(?:online|virtual)\s+(?:event|talk|lecture|session|webinar|seminar|course|panel|discussion)\b/i,
  /\bwebinar\b/i,
  /\b(?:takes?\s+place|held|hosted|delivered|streamed)\s+(?:entirely\s+|exclusively\s+)?(?:online|on\s+zoom|via\s+zoom|virtually)\b/i,
  /\b(?:via|on|using)\s+(?:zoom|microsoft\s+teams|crowdcast)\b/i,
  /\bonline\s+(?:event|lecture|talk|seminar|session|public\s+event|panel|discussion|book\s+launch|conversation)\b/i,
  /\bjoin\s+(?:us\s+)?online\b/i,
];

export interface OnlineInput {
  location?: string | null;
  texts?: Array<string | null | undefined>;
}

/**
 * Online-only → true; in person *or hybrid* → false; unknown → null.
 * The location field is the strongest signal: if it mentions online-ness and
 * nothing but filler remains once those words are removed, it's online-only;
 * if a venue name remains, it's hybrid (= in person).
 */
export function classifyOnline({ location, texts = [] }: OnlineInput): boolean | null {
  const loc = clean(location);
  if (loc) {
    const mentionsOnline = new RegExp(ONLINE_WORDS.source, "i").test(loc);
    if (!mentionsOnline) return false; // a real venue
    if (HYBRID_LOC.test(loc)) return false;
    const remainder = loc.replace(ONLINE_WORDS, " ").replace(FILLER_WORDS, " ").replace(/[^\p{L}]+/gu, "");
    return remainder.length < 4;
  }

  const prose = texts.map(clean).filter(Boolean).join(" \n ");
  if (!prose) return null;
  if (/\b(?:hybrid|in[\s-]person\s+(?:and|&|or|\+)\s+(?:online|virtual|via)|(?:online|virtual)\s+(?:and|&|or|\+)\s+in[\s-]person|in\s+person\s+or\s+(?:online|via\s+(?:the\s+)?livestream))\b/i.test(prose)) return false;
  if (/\bin[\s-]person\b/i.test(prose) && !/\bno\s+in[\s-]person\b/i.test(prose)) return false;
  if (ONLINE_PROSE.some((re) => re.test(prose))) return true;
  return null;
}

// ---------------------------------------------------------------------------

/**
 * Places that are definitely *not* London. Used only to drop in-person events
 * from multi-region sources (RSC, IOP, Geological Society, 5x15 tours…).
 * London is full of streets named after other places (Oxford Street,
 * Leicester Square, Liverpool Street, Lincoln's Inn…), so a place name only
 * counts when it isn't followed by a street/building word.
 */
const NON_LONDON_PLACES = [
  "aberdeen", "bath", "belfast", "birmingham", "bournemouth", "bradford", "brighton", "bristol", "cambridge",
  "canterbury", "cardiff", "carlisle", "chelmsford", "cheltenham", "chester", "colchester", "cornwall", "coventry",
  "derby", "devon", "dublin", "dundee", "durham", "edinburgh", "exeter", "glasgow", "gloucester", "grassmarket",
  "guildford", "harrogate", "hull", "inverness", "ipswich", "lancaster", "leeds", "leicester", "lincoln",
  "liverpool", "manchester", "milton keynes", "newcastle", "northampton", "norwich", "nottingham", "oxford",
  "plymouth", "portsmouth", "preston", "salisbury", "sheffield", "southampton", "st andrews", "stirling",
  "sunderland", "swansea", "swindon", "taunton", "tyntesfield", "warwick", "winchester", "wolverhampton",
  "worcester", "york", "cumbria", "yorkshire", "lake district", "slapton", "peterborough", "southend", "southend-on-sea",
  "luton", "st albans", "maidstone", "tunbridge wells", "hastings", "eastbourne", "worthing", "chichester", "poole",
  "weymouth", "truro", "falmouth", "tiverton", "kendal", "grange-over-sands", "king's lynn", "whitehaven",
  "scarborough", "blackpool", "bolton", "stockport", "salford", "wigan", "warrington", "shrewsbury", "hereford",
  "stratford-upon-avon", "newport", "wrexham", "aberystwyth", "bangor", "londonderry", "derry", "fermanagh", "perth",
  "galway", "cork", "limerick", "torquay", "yeovil", "basingstoke", "woking", "bedford", "kettering", "loughborough",
  "stoke-on-trent", "leamington", "margate", "dover", "folkestone", "ramsgate", "whitstable", "great yarmouth",
  "lowestoft", "bury st edmunds", "ely", "henley-on-thames", "windsor", "sevenoaks", "tonbridge", "crawley", "horsham",
  "lewes", "harwich", "clacton", "keswick", "ambleside", "buxton", "matlock", "ludlow", "malvern",
  "paris", "new york", "berlin", "amsterdam", "brussels", "washington", "boston", "sydney", "toronto", "hong kong",
  "singapore", "tokyo", "dubai", "abu dhabi", "delhi", "mumbai", "beijing", "los angeles", "san francisco",
];
const NON_LONDON_RE = new RegExp(`\\b(?:${NON_LONDON_PLACES.map((p) => p.replace(/ /g, "\\s+")).join("|")})\\b`, "gi");
const STREETISH_AFTER =
  /^(?:['’]s\b|street|st\b|road|rd\b|square|sq\b|place|pl\b|house|circus|way|terrace|gardens?|gate|lane|row|rooms?|hall|court|crescent|mews|walk|yard|wharf|buildings?|avenue|ave\b|park|close|drive|hill|heath|bridge|palace|inn|theatre|college|school)/i;
const LONDON_RE = /\blondon\b|\b(?:westminster|camden|islington|southwark|lambeth|hackney|kensington|chelsea|bloomsbury|holborn|soho|covent garden|mayfair|piccadilly|strand|south bank|southbank|barbican|greenwich|stratford|shoreditch|clerkenwell|marylebone|fitzrovia|highgate|hampstead|kew|richmond|wimbledon|white city|whitechapel|aldgate|city of london|canary wharf|king'?s cross|euston|paddington|battersea|brixton|notting hill)\b/i;
// Greater London postcode areas (inner + outer boroughs).
const LONDON_POSTCODE_AREAS = new Set(["E", "EC", "N", "NW", "SE", "SW", "W", "WC", "BR", "CR", "DA", "EN", "HA", "IG", "KT", "RM", "SM", "TW", "UB", "WD"]);

/** True when a location string clearly names somewhere outside London (and not London itself). */
export function isOutsideLondon(location: string | null | undefined): boolean {
  const loc = clean(location);
  if (!loc) return false;
  const postcode = loc.match(/\b([A-Z]{1,2})\d[A-Z\d]?\s*\d[ABD-HJLNP-UW-Z]{2}\b/);
  if (postcode) return !LONDON_POSTCODE_AREAS.has(postcode[1]);
  if (LONDON_RE.test(loc)) return false;
  for (const m of loc.matchAll(NON_LONDON_RE)) {
    const after = loc.slice((m.index ?? 0) + m[0].length).trimStart();
    const before = loc.slice(0, m.index ?? 0);
    if (STREETISH_AFTER.test(after)) continue;
    if (/\b(?:of|duke|prince|princess)\s*$/i.test(before)) continue;
    return true;
  }
  return false;
}

/**
 * True when a location positively names London (a Greater London postcode,
 * "London", or a well-known London district). Stricter than
 * !isOutsideLondon(): for national sources whose venues can be anywhere.
 */
export function isInLondon(location: string | null | undefined): boolean {
  const loc = clean(location);
  if (!loc) return false;
  const postcode = loc.match(/\b([A-Z]{1,2})\d[A-Z\d]?\s*\d[ABD-HJLNP-UW-Z]{2}\b/);
  if (postcode) return LONDON_POSTCODE_AREAS.has(postcode[1]);
  return LONDON_RE.test(loc);
}
