/** Text clean-up helpers shared by every scraper. */

import * as cheerio from "cheerio";
import { GIVEN_NAMES } from "./given-names.ts";

/** Collapses all whitespace (incl. nbsp/zero-width) to single spaces and trims. */
export function clean(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/[​-‍﻿]/g, "")
    .replace(/[\s ]+/g, " ")
    .trim();
}

/**
 * HTML fragment → readable plain text. Block elements and <br> become
 * sentence breaks so "<p>One</p><p>Two</p>" doesn't read as "OneTwo".
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  if (!/[<&]/.test(html)) return clean(html);
  const $ = cheerio.load(`<div id="__root">${html}</div>`);
  const root = $("#__root");
  root.find("script, style, noscript, iframe, svg, img, figure, button").remove();
  root.find("br").replaceWith(" ");
  root.find("p, div, li, h1, h2, h3, h4, h5, h6, tr, blockquote, section").each((_, el) => {
    $(el).append(" ");
  });
  return clean(root.text());
}

/** Truncates at a word boundary, appending an ellipsis when anything was cut. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s,;:.–—-]+$/, "") + "…";
}

const QUOTE_PAIRS: Array<[string, string]> = [
  ['"', '"'],
  ["“", "”"],
  ["'", "'"],
  ["‘", "’"],
];

/** `"The Title"` → `The Title` (only when the whole string is wrapped). */
export function stripWrappingQuotes(text: string): string {
  const t = text.trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (t.length > 2 && t.startsWith(open) && t.endsWith(close) && !t.slice(1, -1).includes(close)) {
      return t.slice(1, -1).trim();
    }
  }
  return t;
}

export function uniq<T>(items: Iterable<T>): T[] {
  return [...new Set(items)];
}

// Trailing post-nominals: all-caps initialisms (OBE, FSA, KC), Fellowship styles (FRHistS, FMedSci, FREng), degrees.
const POST_NOMINALS = /(?:,?\s+(?:[A-Z]{2,6}|F[A-Z][A-Za-z]{1,7}|Ph\.?D|D\.?Phil|M\.?Sc|B\.?Sc|Hon))+\s*$/;

/** "David Olusoga OBE" → "David Olusoga" (post-nominals only; honorifics are kept). */
export function cleanName(raw: string): string {
  return clean(raw).replace(/^(?:and|with|&)\s+/i, "").replace(/[,;.]+$/, "").replace(POST_NOMINALS, "").trim();
}

/**
 * Case-insensitive uniq for names, preserving the first spelling seen. A name
 * that merely extends another with extra words ("Dr Nick Summerton
 * Retrospective" vs "Dr Nick Summerton") collapses to the shorter one.
 */
export function uniqNames(names: Iterable<string>): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const name = cleanName(raw);
    if (!name) continue;
    const key = nameKey(name);
    if (!key) continue;
    const same = out.findIndex((n) => nameKey(n) === key);
    if (same >= 0) {
      // "Ben Okri" then "Sir Ben Okri": keep the fuller form, in the first one's place.
      if (name.length > out[same].length) out[same] = name;
      continue;
    }
    if (out.some((n) => key.startsWith(`${nameKey(n)} `))) continue;
    for (let i = out.length - 1; i >= 0; i--) if (nameKey(out[i]).startsWith(`${key} `)) out.splice(i, 1);
    out.push(name);
  }
  return out;
}

const LEADING_HONORIFICS = /^(?:(?:professor|prof|dr|sir|dame|lord|lady|baroness|baron|rev(?:erend)?|rt\.? hon|the hon|mr|mrs|ms|mx|miss)\.?\s+)+/i;

/** Comparison key for a person's name: no honorifics, accents or case. */
function nameKey(name: string): string {
  return name
    .replace(LEADING_HONORIFICS, "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits "A, B and C" / "A & B" into names. */
export function splitNames(text: string): string[] {
  return uniqNames(
    clean(text)
      .split(/\s*(?:,|;|\/|\band\b|&|\+)\s*/i)
      .filter((part) => part.length > 1),
  );
}

/**
 * Extracts people from common title/subtitle phrasings:
 *   "Jane Doe in conversation with John Roe" · "with Jane Doe and John Roe"
 *   "An evening with Jane Doe" · "Speaker: Jane Doe"
 * Deliberately conservative: only returns capitalised name-like chunks.
 */
export function speakersFromPhrase(text: string): string[] {
  const t = clean(text)
    .replace(/,?\s*\b(?:moderated|chaired|hosted|introduced|interviewed|presented)\s+by\s+/gi, ", ")
    .replace(/\s*[.;]\s*$/, "");
  const names: string[] = [];
  const conv = t.match(/^(.+?)\s+in conversation with\s+(.+)$/i);
  const solo = t.match(/^(.+?)\s+in conversation$/i);
  if (conv) {
    names.push(...splitNames(conv[1].replace(/^.*:\s*/, "")), ...splitNames(conv[2]));
  } else if (solo) {
    names.push(...splitNames(solo[1].replace(/^.*:\s*/, "")));
  } else {
    const withMatch = t.match(/\b(?:an? (?:evening|afternoon|morning|night|audience) with|in conversation with|hosted by|chaired by|with)\s+(.+)$/i);
    if (withMatch) names.push(...splitNames(withMatch[1]));
    const speaker = t.match(/\bspeakers?:\s*(.+)$/i);
    if (speaker) names.push(...splitNames(speaker[1]));
  }
  return uniqNames(names.filter(looksLikeName));
}

const NOT_NAME_WORDS =
  /\b(?:the|of|and|for|on|in|at|to|a|an|live|online|london|society|college|university|institute|school|centre|center|department|lecture|lectures|talk|event|events|festival|book|launch|q&a|tickets?|guests?|friends|others|more|panel|special|conversation|evening|night|screening|seminar|series|week|day|professor|lecturer|reader|fellow|director|chair|president|history|science|studies|research|technology|information|art|arts|music|theatre|gallery|museum|club|group|network|trust|foundation|award|prize|opening|launch|exhibition|workshop|conference|symposium|forum|summit|debate|discussion|introduction|annual|memorial|limited|ltd|plc|inc|llp|company|consulting|consultancy|sponsor|partners?|agency|council|ministry|office|scientist|engineer|manager|officer|lead|head|senior|principal|geologist|analyst|consultant|advis[eo]r|specialist|researcher|candidate|coordinator|executive|chief|deputy|editor|keynotes?|speakers?|chairs?|hosts?|panellists?|moderators?)\b/i;

/** Starts with an honorific, or with a first name we recognise — required for position-only guesses. */
export function hasPersonMarker(name: string): boolean {
  const t = clean(name);
  if (HONORIFIC.test(t)) return true;
  const first = t.split(/\s+/)[0]?.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "") ?? "";
  return GIVEN_NAMES.has(first);
}

/** "Finance Seminar – Dorje Brody" / "Exploring volcanoes - Professor Sir Steve Sparks" → ["Dorje Brody"…]. */
export function trailingSpeaker(title: string): string[] {
  const t = clean(title);
  const seps = [...t.matchAll(/\s+[–—-]\s+|:\s+/g)];
  const last = seps[seps.length - 1];
  if (!last) return [];
  const tail = t.slice((last.index ?? 0) + last[0].length).replace(/\s*\([^)]*\)\s*$/, "");
  // After a colon the name is as often the subject ("Walk: William Tyndale") as the
  // speaker, so only an honorific ("Lecture: Professor Jane Roe") counts there.
  const colon = last[0].trim() === ":";
  const names = splitNames(tail).filter((n) => looksLikeName(n) && (colon ? HONORIFIC.test(n) : hasPersonMarker(n)));
  return names.length && names.join(" ").length >= tail.replace(/\b(?:and|&)\b/g, "").replace(/[,\s]+/g, " ").trim().length * 0.8 ? names : [];
}

const HONORIFIC = /^(?:(?:Prof(?:essor)?|Dr|Sir|Dame|Lord|Lady|Baroness|Baron|Rev(?:erend)?|Rt\.? Hon\.?|The Hon\.?|Mr|Mrs|Ms|Mx|Emeritus|Associate|Assistant)\.?\s+)+/i;

/** Heuristic: 2–5 capitalised words (allowing particles like "van", "de", titles like "Dr"). */
export function looksLikeName(text: string): boolean {
  const t = clean(text).replace(HONORIFIC, "");
  if (t.length < 4 || t.length > 60) return false;
  if (/\d|[:!?()"“”@/]/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  // "Professor of Information Technology" is a job title, not a person.
  if (/^(?:of|in|for|and|the)$/i.test(words[0])) return false;
  // Possessives ("Brodovitch’s Ballet") and gerunds ("Reissuing…", "Exploring…") mark titles, not people.
  if (words.some((w) => /['’]s$/i.test(w)) || /^[A-Z][a-z]{3,}ing$/.test(words[0])) return false;
  const lowerParticles = /^(?:van|von|de|der|den|da|di|du|la|le|bin|al|el|ibn|y)$/i;
  if (lowerParticles.test(words[words.length - 1])) return false;
  if (!words.every((w) => /^[A-ZÀ-ÖØ-Þ][\p{L}'’.-]*$/u.test(w) || lowerParticles.test(w))) return false;
  const stripped = words.filter((w) => !lowerParticles.test(w)).join(" ");
  return !NOT_NAME_WORDS.test(stripped);
}

/** Title-cases a SHOUTY string (some listings are ALL CAPS). Leaves normal text alone. */
export function unshout(text: string): string {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 6 || letters !== letters.toUpperCase()) return text;
  return text.toLowerCase().replace(/(^|[\s(“"'‘-])(\p{L})/gu, (_, pre, ch) => pre + ch.toUpperCase());
}

/** HTML → text lines (block elements and <br> become line breaks), for "Label: value" parsing. */
export function htmlToLines(html: string | null | undefined): string[] {
  if (!html) return [];
  const $ = cheerio.load(`<div id="__root">${html}</div>`);
  const root = $("#__root");
  root.find("script, style, noscript, iframe, svg, img, figure, button").remove();
  root.find("br").replaceWith("\n");
  root.find("p, div, li, h1, h2, h3, h4, h5, h6, tr, blockquote, section, dt, dd").each((_, el) => {
    $(el).prepend("\n").append("\n");
  });
  return root
    .text()
    .split(/\n+/)
    .map((line) => clean(line))
    .filter(Boolean);
}

/**
 * Value of the first "Label: value" line, e.g. labelled(lines, /^date/i).
 * Also handles the value sitting on the following line ("Venue:" / "The Bell").
 */
export function labelled(lines: string[], label: RegExp): string | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(`^(?:${label.source})\\s*[:：]\\s*(.*)$`, label.flags.replace("g", "")));
    if (!m) continue;
    if (m[1]) return m[1];
    if (lines[i + 1]) return lines[i + 1];
  }
  return null;
}

/** "Thomas Waters: Magick in 7 Objects" → ["Thomas Waters"]; "Naomi Klein and Astra Taylor: …" → both. */
export function leadingSpeakers(title: string): string[] {
  const m = clean(title).match(/^([^:–—|]{4,80}?)\s*[:–—|]\s+\S/);
  if (!m) return [];
  const names = splitNames(m[1]).filter((n) => looksLikeName(n) && hasPersonMarker(n));
  const covered = names.join(" ").length >= m[1].replace(/\b(?:and|&)\b/gi, "").replace(/[,\s]+/g, " ").trim().length * 0.8;
  return covered ? names : [];
}


/**
 * Speakers inferred from a title (+ optional description). Phrases like "X in
 * conversation with Y" are trusted; positional guesses ("X: Title", "Title –
 * X") must look like a person (honorific or known given name), which filters
 * out series names ("Slow Looking: …", "Ethical Matters: …"). Honorific names
 * in the description ("Professor Jane Roe will…") are added too.
 */
export function speakersFromTitle(title: string, context?: string | null): string[] {
  return uniqNames([...speakersFromPhrase(title), ...leadingSpeakers(title), ...trailingSpeaker(title), ...honorificNames(context)]);
}

/**
 * Names introduced by an honorific anywhere in prose: "Hear from Dr Christina
 * Faraday FSA…", "Professor Kayla King will explore…". High precision, so
 * it's safe to run over descriptions.
 */
export function honorificNames(text: string | null | undefined): string[] {
  const t = clean(text);
  const out: string[] = [];
  const re = /\b((?:Professor|Prof\.?|Dr\.?|Sir|Dame|Lord|Lady|Baroness|Baron|Rev(?:erend)?\.?|Rt\.? Hon\.?)(?:\s+(?:Sir|Dame|Dr\.?|Professor))?\s+[A-Z][\p{L}'’-]+(?:\s+(?:[A-Z][\p{L}'’-]+|van|von|de|der|da|di|du|la|le|al|el|bin|ibn)){0,4})/gu;
  for (const m of t.matchAll(re)) {
    const name = m[1].replace(/\s+(?:FSA|FRS|FBA|FRSE|FLS|FRAS|OBE|MBE|CBE|KBE|DBE|PhD|MP)$/g, "");
    if (looksLikeName(name)) out.push(name);
  }
  return uniqNames(out);
}
