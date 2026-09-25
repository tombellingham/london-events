/**
 * King's College London (kcl.ac.uk/events) — another Contensis site; its
 * events calendar calls the (same-origin) Contensis Delivery API with the
 * site's public read-only token. KCL lists ~500 upcoming events, most of them
 * internal (student drop-ins, staff training), so we keep the public-facing
 * event types: public lectures, seminars, conferences and festivals.
 */

import type { RawEvent, Source } from "../core/types.ts";
import { parseNaiveLondon } from "../core/dates.ts";
import { clean, htmlToText, speakersFromPhrase } from "../core/text.ts";

const SITE = "https://www.kcl.ac.uk";
const API = `${SITE}/api/delivery/projects/website/entries/search`;
const TOKEN = "JjV9NgvYm8BQgTNx2AtThsRBeK5qZxArDnRc2SKrzYWzvsS6";

const EVENT_TYPES: Record<string, string> = {
  "cb7cba1a-7738-43c6-a9f0-5856b5c0f03d": "Public lecture",
  "c97779c4-996c-437b-9c8b-d9d3cbcab957": "Seminar",
  "76be3609-2e4d-481e-a775-1e091bb313ab": "Conference",
  "f76fafde-4ba8-4754-b42a-a321989fae46": "Festival",
};
const ONLINE_TYPE = "97592262-0e99-4e2e-b6bc-7de40898223e";

interface Linked {
  entryTitle?: string;
  sys?: { id?: string };
}
interface KclEntry {
  title?: string;
  entryTitle?: string;
  description?: string;
  date?: { from?: string; to?: string };
  room?: string;
  location?: Linked;
  type?: Linked[];
  cancelled?: boolean;
  relatedPeople?: Linked[];
  content?: Array<{ type?: string; value?: unknown }>;
  sys?: { uri?: string };
}

function contentText(entry: KclEntry): string {
  return (entry.content ?? [])
    .map((block) => (typeof block.value === "string" ? htmlToText(block.value) : ""))
    .join(" ");
}

export const kcl: Source = {
  id: "kcl",
  name: "King's College London",
  homepage: `${SITE}/events`,
  defaults: { free: true, location: "King's College London" },
  async scrape(ctx) {
    const where = [
      { field: "sys.versionStatus", equalTo: "published" },
      { field: "sys.contentTypeId", equalTo: "events" },
      { field: "date.from", greaterThanOrEqualTo: ctx.horizon.from.toISOString() },
      { field: "date.from", lessThan: ctx.horizon.to.toISOString() },
      { field: "type.sys.id", in: Object.keys(EVENT_TYPES) },
      { not: [{ field: "searchOptions.includeInKCLSiteListings", in: ["false"] }] },
    ];
    const events: RawEvent[] = [];
    for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
      const params = new URLSearchParams({
        where: JSON.stringify(where),
        orderBy: JSON.stringify([{ asc: "date.from" }]),
        fields: "title,entryTitle,description,date,room,location,type,cancelled,relatedPeople,content,sys.uri",
        linkDepth: "1",
        pageIndex: String(pageIndex),
        pageSize: "50",
      });
      const res = await ctx.http.json<{ items: KclEntry[]; pageCount: number }>(`${API}?${params}`, {
        headers: { accesstoken: TOKEN, Referer: `${SITE}/events/events-calendar` },
      });
      for (const entry of res.items ?? []) {
        const start = entry.date?.from ? parseNaiveLondon(entry.date.from) : null;
        if (!start || !entry.sys?.uri || entry.cancelled) continue;
        const title = clean(entry.title || entry.entryTitle);
        const body = contentText(entry);
        const typeIds = (entry.type ?? []).map((t) => t.sys?.id ?? "");
        const typeLabels = (entry.type ?? []).map((t) => t.entryTitle ?? "");
        // relatedPeople mixes hosts and speakers; keep the ones the text actually introduces.
        const people = (entry.relatedPeople ?? []).map((p) => clean(p.entryTitle)).filter((n) => n && body.includes(n.split(" ").pop()!));
        const room = clean(entry.room);
        const building = clean(entry.location?.entryTitle);
        events.push({
          title,
          url: new URL(entry.sys.uri, SITE).toString(),
          start,
          end: entry.date?.to ? parseNaiveLondon(entry.date.to) : null,
          location: [room, building].filter(Boolean).join(", ") || null,
          description: entry.description || body,
          speakers: [...speakersFromPhrase(title), ...people],
          hints: [...typeLabels, body],
          online: typeIds.includes(ONLINE_TYPE) && !room && !building ? true : null,
        });
      }
      if (pageIndex + 1 >= (res.pageCount ?? 0)) break;
    }
    return events;
  },
};
