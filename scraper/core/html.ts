/** Cheerio + JSON-LD helpers. */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

export type { CheerioAPI, Cheerio } from "cheerio";
export type Node = AnyNode;

/**
 * Parses HTML. A space is added after every <br> so .text() doesn't glue
 * lines together ("Little Titchfield Campus<br>4-12 Little Titchfield St"
 * would otherwise read "Campus4-12"); the <br>s stay for code that splits on them.
 */
export function loadHtml(html: string): cheerio.CheerioAPI {
  const $ = cheerio.load(html);
  $("br").after(" ");
  return $;
}

/** Resolves a (possibly relative / protocol-relative / entity-encoded) href. */
export function absUrl(href: string | undefined | null, base: string): string | null {
  if (!href) return null;
  const trimmed = href.trim().replace(/&amp;/g, "&");
  if (!trimmed || trimmed.startsWith("#") || /^(?:mailto|tel|javascript):/i.test(trimmed)) return null;
  try {
    return new URL(trimmed, base).toString();
  } catch {
    return null;
  }
}

/**
 * JSON.parse that tolerates the most common CMS bug: raw newlines/tabs inside
 * string literals (invalid JSON, but emitted by several WordPress plugins).
 */
export function parseLenientJson<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // fall through
  }
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of raw) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString && (ch === "\n" || ch === "\r" || ch === "\t")) {
      out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : "\\t";
      continue;
    }
    out += ch;
  }
  try {
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
}

type JsonObject = Record<string, unknown>;

/** Every JSON-LD node in the document (or under `scope`), with @graph/arrays flattened. */
export function jsonLdNodes($: cheerio.CheerioAPI, scope?: cheerio.Cheerio<AnyNode>): JsonObject[] {
  const scripts = scope ? scope.find('script[type="application/ld+json"]') : $('script[type="application/ld+json"]');
  const nodes: JsonObject[] = [];
  scripts.each((_, el) => {
    const parsed = parseLenientJson<unknown>($(el).contents().text());
    const visit = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") {
        const obj = value as JsonObject;
        if (Array.isArray(obj["@graph"])) (obj["@graph"] as unknown[]).forEach(visit);
        else nodes.push(obj);
      }
    };
    visit(parsed);
  });
  return nodes;
}

export function hasType(node: JsonObject, pattern: RegExp): boolean {
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => typeof t === "string" && pattern.test(t));
}

/** `script#__NEXT_DATA__` payload, if present. */
export function nextData<T = unknown>($: cheerio.CheerioAPI): T | null {
  const raw = $("script#__NEXT_DATA__").contents().text();
  return raw ? parseLenientJson<T>(raw) : null;
}

/** The text of the first matching element, cleaned. */
export function textOf($el: cheerio.Cheerio<AnyNode>): string {
  return $el.first().text().replace(/[\s ]+/g, " ").trim();
}

/**
 * Finds the value that follows a label in "definition list"-ish markup, e.g.
 * <dt>Date & Time</dt><dd>9 October 2026 at 14.00</dd> or <h3>Price</h3><p>£10</p>,
 * by scanning the element's text for "Label" and returning the text of the next block.
 */
export function labelledValue($: cheerio.CheerioAPI, label: RegExp, root?: cheerio.Cheerio<AnyNode>): string | null {
  const scope = root ?? $.root();
  let found: string | null = null;
  scope.find("dt, th, h2, h3, h4, h5, h6, strong, b, span, p, div, li").each((_, el) => {
    if (found) return false;
    const $el = $(el);
    const own = $el.clone().children().remove().end().text().replace(/\s+/g, " ").trim();
    if (!own || own.length > 40 || !label.test(own)) return;
    // Inline "Label: value" inside the same element.
    const full = $el.text().replace(/\s+/g, " ").trim();
    const inline = full.replace(label, "").replace(/^[\s:–-]+/, "").trim();
    if (inline && inline.length < 300 && full.length > own.length) {
      found = inline;
      return false;
    }
    const next = $el.next();
    const value = next.text().replace(/\s+/g, " ").trim();
    if (value) {
      found = value;
      return false;
    }
    return;
  });
  return found;
}
