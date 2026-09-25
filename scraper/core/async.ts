/** Small concurrency helpers shared by the runner and scrapers. */

import type { ScrapeContext } from "./types.ts";

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.split("\n")[0].slice(0, 300);
  return String(err).slice(0, 300);
}

/** Runs `fn` over `items` with at most `limit` in flight. Rejections propagate. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Like mapLimit, but a failing item is logged and skipped instead of failing the batch. */
export async function mapSettled<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onError: (item: T, error: unknown) => void,
): Promise<R[]> {
  const out = await mapLimit(items, limit, async (item, i) => {
    try {
      return { ok: true as const, value: await fn(item, i) };
    } catch (error) {
      onError(item, error);
      return { ok: false as const };
    }
  });
  return out.flatMap((r) => (r.ok ? [r.value] : []));
}

/**
 * Enriches listing items with detail-page data. A failing detail page keeps
 * the listing version of the item (logged) instead of losing the event.
 */
export async function enrichAll<T>(
  ctx: ScrapeContext,
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<T>,
  label: (item: T) => string,
): Promise<T[]> {
  let failures = 0;
  const out = await mapLimit(items, limit, async (item) => {
    try {
      return await fn(item);
    } catch (err) {
      failures++;
      if (failures <= 3) ctx.log.warn(`details failed for ${label(item)}: ${errorMessage(err)}`);
      return item;
    }
  });
  if (failures > 3) ctx.log.warn(`${failures}/${items.length} detail pages failed`);
  return out;
}

