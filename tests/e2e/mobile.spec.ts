import { expect, test } from "@playwright/test";
import { NOW } from "./fixture.ts";

test("works on a phone without sideways scrolling", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.clock.setFixedTime(NOW);
  await page.goto("/");
  await expect(page.locator("#result-count")).toHaveText("5 events in the next 7 days");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Tomorrow" }).tap();
  await expect(page.locator(".event")).toHaveCount(2);
  // The long source list starts folded on phones.
  await expect(page.locator("#source-list")).toBeHidden();
  await page.getByText("Choose sources").tap();
  await expect(page.locator("#source-list")).toBeVisible();
});

test("the status page fits a phone too", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.clock.setFixedTime(NOW);
  await page.goto("/status/");
  await expect(page.locator(".health-row")).toHaveCount(3);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
