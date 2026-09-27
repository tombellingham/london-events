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

test("dd/mm: a tap lands on the date input itself, which opens the phone's picker", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.clock.setFixedTime(NOW);
  await page.goto("/");
  const pick = page.locator("#pick-date");
  const input = page.locator("#date-input");
  // iOS opens no picker from script, so the (invisible) input must be what's tapped, over the whole button.
  const [button, field] = [(await pick.boundingBox())!, (await input.boundingBox())!];
  expect(field.x).toBeLessThanOrEqual(button.x);
  expect(field.y).toBeLessThanOrEqual(button.y);
  expect(field.x + field.width).toBeGreaterThanOrEqual(button.x + button.width);
  expect(field.y + field.height).toBeGreaterThanOrEqual(button.y + button.height);
  for (const [fx, fy] of [[0.1, 0.5], [0.5, 0.5], [0.9, 0.5]]) {
    const id = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [button.x + button.width * fx, button.y + button.height * fy]);
    expect(id).toBe("date-input");
  }
  await expect(input).toHaveCSS("font-size", "16px");
  await expect(input).toHaveAttribute("min", "2026-10-01");
  await input.fill("2026-10-06");
  await expect(page.locator("#result-count")).toHaveText("1 event on Tuesday 6 October");
  await expect(pick).toHaveText("06/10");
  // A range again, then the same day once more: it still registers.
  await page.getByRole("button", { name: "Next 7 days" }).tap();
  await expect(input).toHaveValue("");
  await input.fill("2026-10-06");
  await expect(pick).toHaveText("06/10");
});

test("the sources page fits a phone too", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.clock.setFixedTime(NOW);
  await page.goto("/sources/");
  await expect(page.locator(".health-row")).toHaveCount(3);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
