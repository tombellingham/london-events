# London Talks

A daily-scraped listing of talks, lectures and debates at 35 London institutions:
**https://tombellingham.github.io/london-events/**

Every morning a GitHub Actions job scrapes each institution's events pages,
normalises and de-duplicates the results, and publishes a static page. The
full event list ships to the browser inside the page; the filters (day range,
price, format, source, search) run client-side. There is no backend.

## How it works

```
scraper/
  sources/*.ts      one module per institution: find events, return RawEvents
  core/
    runner.ts       runs every source in isolation (time budget, health stats)
    normalize.ts    RawEvent → EventRecord: clean titles, dates, free/online, London-only…
    classify.ts     free/paid and online/in-person heuristics, London location checks
    dedupe.ts       exact (URL + date) and cross-source fuzzy de-duplication
    dates.ts        Europe/London wall-clock parsing ("Tue 6 Oct, 6.30-8pm" → 2026-10-06 18:30)
    http.ts         polite fetch: per-host throttling, retries, bot-wall detection
    browser.ts      shared Chromium for client-rendered or bot-protected sites
    fetch.ts        plain HTTP first, browser fallback; pagination guard
  scrape.ts         CLI → .build/events.json, health.json, history.json
  validate.ts       sanity checks before anything is published
src/                Eleventy site: index.njk, assets/app.js (filters), assets/style.css
tests/unit          node:test unit tests
tests/e2e           Playwright tests (fixture site with a pinned clock, plus a smoke test of the real build)
scripts/probe.mjs   maintenance tool: capture a page's HTML and its XHR/API traffic
```

**Each event** has a title, URL, London date and start time (end times are
ignored), location, description, speakers, and two facets: free vs paid, and
online vs in person (hybrid counts as in person). Unknown facets stay `null`
rather than being guessed.

**Rules applied to every source** (in `normalize.ts`):

- 45-day horizon from today; past events dropped.
- Cancelled/postponed events dropped; "SOLD OUT", "Last few tickets" and
  "[online]"-style markers are stripped from titles (the online marker is kept
  as the format).
- Anything spanning more than 14 days is an exhibition or course, not an
  event, and is dropped.
- Members-/fellows-only events are dropped.
- London only: in-person events elsewhere (tour dates in Brighton, lectures in
  Edinburgh) are dropped, unless they're streamed, in which case they're kept as
  online events with "(livestream)" after the venue.

**De-duplication** first merges records with the same normalised URL on the
same day, then fuzzy-matches different URLs across sources (same day, start
times within 30 minutes, near-identical titles, compatible venues). The richer
record wins and the others are listed under "Also listed by".

**Health.** Every run records, per source: ok / empty / failed, events kept,
events found, requests, duration and warnings. The header shows the latest
totals and a sparkline of recent runs; the Status table at the bottom of the
page has per-source detail and history. The run history lives in the published
`data/history.json`, which each run downloads from the live site and extends
(last 90 runs), so no database or commits are needed.

## Sources

| Source | How it's read |
| --- | --- |
| 5x15 | Events page cards |
| Barbican | Talks & events listing (paginated) + event pages for venue/speakers |
| Birkbeck | Events listing (paginated) + event pages; internal/student sessions excluded |
| The British Academy | Events list (client-rendered, via browser) or its listing API + event pages |
| The Charterhouse | Site's WordPress events API + event pages |
| Conway Hall | What's on listing (paginated) + event pages; Sunday Concerts excluded |
| Frontline Club | Eventbrite organiser API |
| Geological Society | Events search (form POST, paginated) + event pages |
| Gresham College | Site's `whatson.json` + event pages |
| Guardian Live | RSS feed + event articles |
| Guildhall Library | Eventbrite organiser API |
| Highgate Literary & Scientific Institution | The Events Calendar REST API; courses and classes excluded |
| How To Academy | Events calendar + event/tour pages (London dates only) |
| Imperial College London | What's On events feed (talk-like types only) |
| Institute of Physics | Events listing (paginated) + event pages; online or in London only |
| Intelligence Squared | Attend page + event pages (tour dates: London only) |
| King's College London | Site's Contensis content API (public lectures, seminars, …) |
| Linnean Society | VeryConnect events API |
| London Fortean Society | Blogger JSON feed |
| LSE | Site's Contensis content API |
| Pints of Knowledge | Ticket Tailor box office + event pages |
| Royal Academy of Arts | "Talks & lectures" listing + event pages |
| Royal Astronomical Society | Events & meetings listing (paginated) + event pages |
| Royal Geographical Society | Site's listing API + event pages; London and online events only |
| Royal Society | Public and scientific events listings (paginated) + event pages |
| Royal Society of Chemistry | UK & Ireland events listing (paginated) + event pages; London only, courses excluded |
| Royal Society of Medicine | Events page — **currently blocked** (see below) |
| Royal Society for Asian Affairs | Events listing + event pages |
| RSA | Eventbrite organiser API (RSA Public Talks) |
| School of Advanced Study | Site's listing API + event pages (read inside the browser) |
| Seed Talks | Events page (cards + JSON-LD) |
| Society of Antiquaries | Events listing (paginated) + event pages |
| Southbank Centre | Talks & debates listing (paginated) |
| Tate | Talks listings for Tate Modern and Tate Britain + event pages |
| UCL | UCL's public events search feed (Funnelback), public audience only |

## Running it locally

Node 22+.

```sh
npm ci
npx playwright install chromium          # for the browser-based sources
npm run scrape                           # all sources → .build/*.json
npm run scrape -- --only=lse,kcl --print # a few sources, printed, nothing written
npm run scrape -- --drops                # also show why events were dropped
npm run validate                         # the checks CI runs before deploying
npm run site:dev                         # http://localhost:8080 (re-scrape to hot-reload)
npm test && npm run test:e2e             # unit and browser tests
```

Useful environment variables:

- `HTTP_CACHE=1` — cache responses in `.cache/http` for 2 hours while
  developing a scraper (`HTTP_CACHE_TTL_MIN` to change).
- `BROWSER_HEADED=1` — run Chromium headed (CI does, under `xvfb-run`; some
  Cloudflare setups only let a headed browser through). `CHROMIUM_PATH` to use
  a specific Chromium, `BROWSER_PAGES` for concurrent pages (default 4).
- `HORIZON_DAYS` (default 45), `SCRAPE_CONCURRENCY` (default 6).
- Behind an HTTP proxy, Node's `fetch` needs `NODE_USE_ENV_PROXY=1` (the npm
  script sets it).

## Adding or fixing a source

1. Find where the events come from. `node scripts/probe.mjs name=<events page URL>`
   saves the rendered HTML and every XHR/fetch response to `probe-out/`; a JSON
   API behind the page is usually the most reliable thing to read. Add
   `>> <url>` to also fetch a URL from inside the loaded page.
2. Write `scraper/sources/<id>.ts` exporting a `Source` whose `scrape(ctx)`
   returns `RawEvent[]` (see `core/types.ts`). Use `ctx.http` for plain
   requests, `fetchHtml`/`fetchJson` if the site may put up a bot wall,
   `laterPage` around pagination, and `enrichAll` for event pages. Leave
   policing (dates, duplicates, London, free/online) to the core.
3. Register it in `scraper/sources/index.ts` and check it with
   `npm run scrape -- --only=<id> --print --drops`.

## Known limitations

- **Bot protection.** Several sites sit behind Cloudflare. Those that let a
  real browser through are read with headed Chromium; interactive challenges
  are never solved. The Royal Society of Medicine blocks every automated
  visitor, so it currently shows as failed. The British Academy, Institute of
  Physics, Pints of Knowledge and School of Advanced Study let GitHub's
  runners through on some days and not others, so they may show red now and
  then; the health table says so when it happens.
- **RSA** is read from its Eventbrite organiser page (thersa.org blocks
  automated visitors), so only talks sold through Eventbrite appear.
- **UCL** is read from its public events feed, since ucl.ac.uk blocks
  automated visitors; it covers public-audience events only.
- Some sources don't publish everything. Barbican and Tate load prices in
  the browser from their box offices: Barbican events count as paid unless
  the text says free, and Tate's free events come from its own "free"
  filter, without prices for the rest. RSC and IOP rarely give prices, and
  Southbank names speakers only in titles. Missing fields are left empty
  rather than guessed, and an unknown price matches neither the Free nor the
  Paid filter.
