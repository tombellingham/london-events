import { expect, test, type Locator, type Page } from "@playwright/test";
import { NOW } from "./fixture.ts";

/** Opens a page of the fixture site ("" = the events page, "sources/", or a "?query"). */
async function open(page: Page, query = ""): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/fonts\.(googleapis|gstatic)/.test(msg.text())) errors.push(msg.text());
  });
  // Fonts come from Google; the tests don't need them (and may run offline).
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.clock.setFixedTime(NOW);
  await page.goto(`/${query}`);
  return errors;
}

const count = (page: Page) => page.locator("#result-count");
/** The id of whatever a click at the middle of `target` would land on. */
async function hitAt(page: Page, target: Locator): Promise<string | undefined> {
  const box = (await target.boundingBox())!;
  return page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [box.x + box.width / 2, box.y + box.height / 2]);
}

test("renders the next 7 days by default, grouped by day", async ({ page }) => {
  const errors = await open(page);
  await expect(count(page)).toHaveText("5 events in the next 7 days");
  await expect(page.getByRole("button", { name: "Next 7 days" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".day__title")).toHaveText([/Thursday 1 October\s*Today/, /Friday 2 October\s*Tomorrow/, /Tuesday 6 October/]);
  // Within a day: timed events by time, untimed last.
  await expect(page.locator(".event__title")).toHaveText([
    "Morning lecture on maps",
    "Evening debate on rivers",
    "Evening seminar on stars",
    "All-day symposium on soil",
    "Élan vital: a talk on Bergson",
  ]);
  // 10:00 has passed at 10:30.
  await expect(page.locator(".event").first()).toHaveClass(/event--past/);
  expect(errors).toEqual([]);
});

test("shows the event details a reader needs", async ({ page }) => {
  await open(page);
  const debate = page.locator(".event", { hasText: "Evening debate on rivers" });
  await expect(debate.locator(".event__time")).toHaveText("19:00");
  await expect(debate.locator(".event__meta")).toContainText("The Beta Society");
  await expect(debate.locator(".event__meta")).toContainText("Senate House");
  await expect(debate.locator(".event__meta")).toContainText("£10");
  await expect(debate.locator(".event__speakers")).toHaveText("With Jane Doe, Dr John Roe");
  await expect(debate.locator("a").first()).toHaveAttribute("href", /^https:\/\/beta\.example\/events\//);
  const seminar = page.locator(".event", { hasText: "Evening seminar on stars" });
  await expect(seminar.locator(".event__meta")).toContainText("Burlington House");
  await expect(seminar.locator(".event__meta")).toContainText("Free");
  await expect(page.locator(".event", { hasText: "Élan vital" }).locator(".event__also")).toContainText("Also listed by Alpha Institute");
  await page.getByRole("button", { name: "Next 30 days" }).click();
  await expect(page.locator(".event", { hasText: "Autumn lecture" }).locator(".event__meta")).toContainText("Free");
});

test("time windows", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.locator(".event__title")).toHaveText(["Morning lecture on maps", "Evening debate on rivers"]);
  await expect(count(page)).toHaveText("2 events today");

  await page.getByRole("button", { name: "Tomorrow" }).click();
  await expect(page.locator(".event__title")).toHaveText(["Evening seminar on stars", "All-day symposium on soil"]);

  await page.getByRole("button", { name: "Next 30 days" }).click();
  await expect(count(page)).toHaveText("8 events in the next 30 days");
  await expect(page.locator(".event", { hasText: "Paid talk without a listed price" }).locator(".event__meta")).toContainText("Paid");
  await expect(page.locator(".event__title", { hasText: "Beyond the thirty-day window" })).toHaveCount(0);
});

test("price facet", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Free", exact: true }).click();
  await expect(page.locator(".event__title")).toHaveText(["Morning lecture on maps", "Evening seminar on stars", "All-day symposium on soil"]);
  await page.getByRole("button", { name: "Paid" }).click();
  await expect(page.locator(".event__title")).toHaveText(["Evening debate on rivers", "Élan vital: a talk on Bergson"]);
  await page.getByRole("button", { name: "Any" }).click();
  await expect(count(page)).toHaveText("5 events in the next 7 days");
  // There is no format filter: online-only events aren't listed at all.
  await expect(page.locator('[data-filter="format"]')).toHaveCount(0);
});

test("search is accent-insensitive and highlights matches", async ({ page }) => {
  await open(page);
  await page.getByLabel("Search").fill("elan");
  await expect(count(page)).toHaveText("1 event in the next 7 days");
  await expect(page.locator(".event__title mark")).toHaveText("Élan");
  await page.getByLabel("Search").fill("jane doe");
  await expect(page.locator(".event__title")).toHaveText(["Evening debate on rivers"]);
  await page.getByLabel("Search").fill("zzz");
  await expect(page.locator(".empty")).toContainText("No events match these filters");
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(count(page)).toHaveText("5 events in the next 7 days");
});

test("sources can be switched off, and the choice survives a reload", async ({ page }) => {
  await open(page);
  await expect(page.locator("#sources-count")).toHaveText("3 of 3");
  await expect(page.locator(".source", { hasText: "Alpha Institute" }).locator(".source__count")).toHaveText("3"); // this week's events, whatever the toggles
  await page.locator(".source", { hasText: "The Beta Society" }).click();
  await expect(page.locator(".event__title")).toHaveText(["Morning lecture on maps", "Evening seminar on stars", "All-day symposium on soil"]);
  await expect(page).toHaveURL(/off=beta/);
  await page.reload();
  await expect(page.locator(".source", { hasText: "The Beta Society" }).locator("input")).not.toBeChecked();
  await expect(count(page)).toHaveText("3 events in the next 7 days · 2 of 3 sources");

  await page.getByRole("button", { name: "None" }).click();
  await expect(page.locator(".empty")).toBeVisible();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(count(page)).toHaveText("5 events in the next 7 days");
});

test("filters are shareable through the URL", async ({ page }) => {
  await open(page, "?when=month&price=paid&q=bergson");
  await expect(page.getByRole("button", { name: "Next 30 days" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Search")).toHaveValue("bergson");
  await expect(page.locator(".event__title")).toHaveText(["Élan vital: a talk on Bergson"]);
});

test("the title shares its top line with the page links", async ({ page }) => {
  await open(page);
  const title = page.getByRole("heading", { level: 1 });
  await expect(title).toHaveText("Talks & lectures in London");
  await expect(page).toHaveTitle("Talks & lectures in London");
  await expect(page.getByText("London Talks", { exact: false })).toHaveCount(0);
  const [h1, nav] = await Promise.all([title.boundingBox(), page.getByRole("link", { name: "Sources" }).boundingBox()]);
  // Level with the top of the title, not its baseline.
  expect(nav!.y - h1!.y).toBeGreaterThanOrEqual(0);
  expect(nav!.y - h1!.y).toBeLessThan(6);
});

test("the price comes first on the meta line, as a coloured tag", async ({ page }) => {
  await open(page);
  const free = page.locator(".event", { hasText: "Morning lecture on maps" }).locator(".event__meta");
  await expect(free.locator(":scope > :first-child")).toHaveText("Free");
  await expect(free).toHaveText(/^Free\s*Alpha Institute·Senate House/);
  const paid = page.locator(".event", { hasText: "Evening debate on rivers" }).locator(".event__meta > :first-child");
  await expect(paid).toHaveText("£10");
  for (const [tag, background] of [[free.locator(".tag"), "rgb(94, 153, 113)"], [paid, "rgb(184, 48, 118)"]] as const) {
    await expect(tag).toHaveCSS("background-color", background);
    await expect(tag).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(tag).toHaveCSS("font-weight", "600");
    await expect(tag).toHaveCSS("border-radius", "4.8px");
    await expect(tag).toHaveCSS("padding", "0px 4.8px");
  }
  await page.getByRole("button", { name: "Next 30 days" }).click();
  await expect(page.locator(".event", { hasText: "Paid talk without a listed price" }).locator(".tag--paid")).toHaveText("Paid");
});

test("day headings are blue, with the relative day in heavy type", async ({ page }) => {
  await open(page);
  const heading = page.locator(".day__title").first();
  await expect(heading).toHaveCSS("color", "rgb(4, 90, 182)");
  await expect(heading).toHaveCSS("border-bottom-color", "rgb(4, 90, 182)");
  await expect(heading).toHaveCSS("font-size", "12.8px");
  const rel = page.locator(".day__rel").first();
  await expect(rel).toHaveText(/Today|Tomorrow/);
  await expect(rel).toHaveCSS("color", "rgb(4, 90, 182)");
  await expect(rel).toHaveCSS("font-weight", "800");
});

test("the title goes home, with every filter cleared", async ({ page }) => {
  await open(page, "?when=month&price=paid&q=bergson&off=gamma");
  const home = page.getByRole("link", { name: "Talks & lectures in London" });
  await expect(home).toHaveAttribute("href", "./");
  await home.click();
  await expect(page).toHaveURL("http://127.0.0.1:4173/");
  await expect(page.getByRole("button", { name: "Next 7 days" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Any", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Search")).toHaveValue("");
  await expect(count(page)).toHaveText("5 events in the next 7 days");
  // Nothing comes back from this browser's memory either.
  await page.reload();
  await expect(count(page)).toHaveText("5 events in the next 7 days");
});

test("dd/mm picks a single day, which is never saved", async ({ page }) => {
  await open(page, "?price=paid");
  const pick = page.locator("#pick-date");
  await expect(pick).toHaveText("dd/mm");
  // With a mouse the button itself takes the click (and calls showPicker()).
  expect(await hitAt(page, pick)).toBe("pick-date");
  await pick.click();
  await page.locator("#date-input").fill("2026-10-06");
  await expect(count(page)).toHaveText("1 event on Tuesday 6 October");
  await expect(page.locator(".event__title")).toHaveText(["Élan vital: a talk on Bergson"]);
  await expect(pick).toHaveText("06/10");
  await expect(pick).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Next 7 days" })).toHaveAttribute("aria-pressed", "false");
  // Not in the URL (only the other filters are), nor remembered by the browser.
  await expect(page).toHaveURL(/\?price=paid$/);
  await page.reload();
  await expect(count(page)).toHaveText("2 events in the next 7 days");
  await expect(pick).toHaveText("dd/mm");

  // Choosing a range again puts dd/mm back.
  await pick.click();
  await page.locator("#date-input").fill("2026-10-21");
  await expect(count(page)).toHaveText("1 event on Wednesday 21 October");
  await page.getByRole("button", { name: "Next 30 days" }).click();
  await expect(pick).toHaveText("dd/mm");
  await expect(count(page)).toHaveText("3 events in the next 30 days");
  await expect(page).toHaveURL(/when=month/);
});

test("sources without events under the filters are faded and locked", async ({ page }) => {
  await open(page);
  // Gamma's only event is 11 days away.
  const gamma = page.locator(".source", { hasText: "Gamma College" });
  await expect(gamma).toHaveClass(/source--none/);
  await expect(gamma.locator("input")).toBeDisabled();
  await expect(gamma).toHaveAttribute("title", "No events match the current filters");
  await expect(page.locator(".source", { hasText: "Alpha Institute" })).not.toHaveClass(/source--none/);

  await page.getByRole("button", { name: "Next 30 days" }).click();
  await expect(gamma).not.toHaveClass(/source--none/);
  await expect(gamma.locator("input")).toBeEnabled();

  await page.getByLabel("Search").fill("bergson");
  await expect(page.locator(".source--none")).toHaveText([/Alpha Institute/, /Gamma College/]);
  await expect(page.locator(".source", { hasText: "The Beta Society" }).locator("input")).toBeEnabled();
});

test("the events page shows when it was updated, and no other status", async ({ page }) => {
  await open(page);
  await expect(page.locator(".lede")).toHaveText(/^\s*\d+ upcoming in-person talks & lectures from 3 institutions\s*$/);
  await expect(page.locator(".lede strong")).toHaveText("in-person");
  await expect(page.locator("#updated")).toHaveText("Last updated Thu 1 Oct, 05:30");
  await expect(page.getByText(/\bok\b|failed/)).toHaveCount(0);
  await expect(page.locator(".health-pill, .spark, .health-table")).toHaveCount(0);
  await expect(page.locator(".source", { hasText: "Gamma College" })).not.toHaveClass(/source--(?:ok|empty|error)/);
  await expect(page.locator("footer")).toHaveCount(0);
  await page.getByRole("link", { name: "Sources", exact: true }).click();
  await expect(page).toHaveURL(/\/sources\/$/);
  await expect(page.getByRole("heading", { name: "Sources", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle("Sources · Talks & lectures in London");
});

test("the sources page: totals, per-source detail, recent runs and raw data", async ({ page }) => {
  const errors = await open(page, "sources/");
  await expect(page.locator(".masthead__nav a")).toHaveText(["Events"]);
  await expect(page.locator("footer")).toHaveCount(0);
  const header = page.locator("#health-summary");
  await expect(header).toContainText("Last updated Thu 1 Oct, 05:30");
  await expect(header).toContainText("took 2 min 0 s");
  await expect(header).toContainText("2 ok");
  await expect(header).toContainText("1 failed");
  await expect(page.locator("#history-spark i")).toHaveCount(3);
  await expect(page.locator(".health-row")).toHaveCount(3);

  const gamma = page.locator(".health-row", { hasText: "Gamma College" });
  await expect(gamma).toContainText("failed");
  await expect(gamma).toContainText("Blocked by Cloudflare bot protection");
  await expect(gamma).toContainText("Listing its events from the last good run, Tue 29 Sept.");
  await expect(gamma.locator("td.num").first()).toHaveText("1");

  const alpha = page.locator(".health-row", { hasText: "Alpha Institute" });
  await expect(alpha.locator(".runs i")).toHaveCount(3);
  await expect(alpha.locator("td.num").nth(1)).toHaveAttribute("title", "Dropped: online-only 2, past 1");

  const beta = page.locator(".health-row", { hasText: "The Beta Society" });
  await beta.getByText("1 warning").click();
  await expect(beta).toContainText("stopped paginating at page 2: HTTP 500");

  // Raw data comes last, as a titled section of its own.
  const rawData = page.getByRole("heading", { name: "Raw data", level: 1 });
  await expect(rawData).toBeVisible();
  expect(await page.evaluate(() => document.querySelector(".health")!.compareDocumentPosition(document.querySelector("#data")!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await page.getByRole("link", { name: "health.json" }).click();
  await expect(page).toHaveURL(/\/data\/health\.json$/);
  await page.goBack();
  await page.getByRole("link", { name: "Events", exact: true }).click();
  await expect(page.locator("#result-count")).toHaveText("5 events in the next 7 days");
  expect(errors).toEqual([]);
});

test("raw data is published alongside the page", async ({ page, request }) => {
  await open(page);
  for (const file of ["events.json", "health.json", "history.json", "sources/alpha.json"]) {
    const res = await request.get(`/data/${file}`);
    expect(res.ok()).toBe(true);
    expect(await res.json()).toBeTruthy();
  }
});

test("warns when the data is stale, on both pages", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.clock.setFixedTime(new Date(NOW.getTime() + 3 * 24 * 3600 * 1000));
  await page.goto("/");
  await expect(page.locator("#updated .health-stale")).toHaveText("Data is 3 days old");
  await page.goto("/sources/");
  await expect(page.locator("#health-summary .health-stale")).toHaveText("Data is 3 days old");
});

test("fresh data carries no staleness warning", async ({ page }) => {
  await open(page);
  await expect(page.locator(".health-stale")).toHaveCount(0);
});
