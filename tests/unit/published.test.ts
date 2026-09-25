import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { publishedHistory, publishedSnapshot } from "../../scraper/core/published.ts";

const good = {
  id: "lse",
  scrapedAt: "2026-09-24T04:30:00.000Z",
  events: [
    { id: "a", source: "lse", title: "A talk", url: "https://lse.example/a", date: "2026-10-01", time: "18:30", start: "2026-10-01T17:30:00.000Z", speakers: [] },
    { title: "No date or url" },
  ],
};
const files: Record<string, unknown> = {
  "/site/data/sources/lse.json": good,
  "/site/data/sources/kcl.json": { id: "not-kcl", scrapedAt: good.scrapedAt, events: [] },
  "/site/data/history.json": [{ at: "2026-09-24T04:30:00.000Z", ok: 1, empty: 0, failed: 0, events: 1, counts: {} }, null],
};

let server: Server;
let site: string;
before(async () => {
  server = createServer((req, res) => {
    const body = files[req.url ?? ""];
    if (body === undefined) res.writeHead(404).end("not found");
    else res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  site = `http://127.0.0.1:${(server.address() as AddressInfo).port}/site/`;
});
after(() => server.close());

describe("reading back the live site", () => {
  it("loads a source's last good scrape, skipping malformed events", async () => {
    const snap = await publishedSnapshot(site, "lse");
    assert.equal(snap?.scrapedAt, good.scrapedAt);
    assert.deepEqual(snap?.events.map((e) => e.title), ["A talk"]);
  });
  it("ignores missing or mislabelled snapshots", async () => {
    assert.equal(await publishedSnapshot(site, "ucl"), null);
    assert.equal(await publishedSnapshot(site, "kcl"), null);
    assert.equal(await publishedSnapshot("http://127.0.0.1:9/nothing-here", "lse"), null);
  });
  it("loads the run history", async () => {
    assert.equal((await publishedHistory(site)).length, 1);
  });
});
