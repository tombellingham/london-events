import { expect, test, type Page } from "@playwright/test";
import { NOW } from "./fixture.ts";

/** Opens a page of the fixture site ("" = the events page, "status/", or a "?query"). */
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

test("the events page shows when it was updated, and no other status", async ({ page }) => {
  await open(page);
  await expect(page.locator("#updated")).toHaveText("Updated Thu 1 Oct, 05:30");
  await expect(page.getByText(/\bok\b|failed/)).toHaveCount(0);
  await expect(page.locator(".health-pill, .spark, .health-table")).toHaveCount(0);
  await expect(page.locator(".source", { hasText: "Gamma College" })).toHaveAttribute("class", "source");
  await page.getByRole("link", { name: "Scraper status and raw data" }).click();
  await expect(page).toHaveURL(/\/status\/$/);
  await expect(page.getByRole("heading", { name: "Status", level: 1 })).toBeVisible();
});

test("the status page: totals, per-source detail and recent runs", async ({ page }) => {
  const errors = await open(page, "status/");
  const header = page.locator("#health-summary");
  await expect(header).toContainText("Updated Thu 1 Oct, 05:30");
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
  await page.goto("/status/");
  await expect(page.locator("#health-summary .health-stale")).toHaveText("Data is 3 days old");
});

test("fresh data carries no staleness warning", async ({ page }) => {
  await open(page);
  await expect(page.locator(".health-stale")).toHaveCount(0);
});
