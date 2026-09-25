import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// The real build (from today's scrape): it must load cleanly and render events.
test("the real build renders and filters", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/fonts\.(googleapis|gstatic)/.test(msg.text())) errors.push(msg.text());
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.goto("/");

  const data = JSON.parse(readFileSync("_site/data/events.json", "utf8")) as { sources: unknown[]; events: unknown[] };
  await expect(page.locator("#source-list input")).toHaveCount(data.sources.length);
  await expect(page.locator("#result-count")).toHaveText(/^\d[\d,]* events? in the next 7 days$/);

  await page.getByRole("button", { name: "Next 30 days" }).click();
  const shown = Number(((await page.locator("#result-count").innerText()).match(/^[\d,]+/)?.[0] ?? "0").replace(/,/g, ""));
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThanOrEqual(data.events.length);
  await expect(page.locator(".event").first()).toBeVisible();
  expect(errors).toEqual([]);
});
