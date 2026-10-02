/**
 * Pagination helpers.
 *
 * The two APIs paginate differently:
 *
 * - MySuzuki returns a real `pagination.total_page`, so iteration is bounded.
 * - e-Parts exposes no page count at all, so iteration must stop when a page
 *   yields nothing new.
 *
 * `walkPages` handles both by taking a `totalPage` of `null` for "unknown".
 */

/** One page, normalised across the two APIs. */
export interface Page<T> {
  items: T[];
  /** Last page number, or `null` when the API does not report one. */
  totalPage: number | null;
}

export interface WalkOptions {
  /** First page to request. Default `1`. */
  startPage?: number;
  /** Safety cap on pages requested. Default `1000`. */
  maxPages?: number;
  /**
   * Return a stable key per item to suppress duplicates.
   *
   * Only needed for APIs where a server might ignore the page parameter;
   * supplying it lets the walk stop early instead of looping forever on the
   * same page. Omit it when items are known to be unique per page.
   */
  getKey?: (item: never) => string | number | undefined;
}

/**
 * Yield items page by page.
 *
 * Stops when the reported `totalPage` is reached, or — when `totalPage` is
 * `null` — when a page contributes no new items, or at `maxPages`.
 */
export async function* walkPages<T>(
  fetchPage: (page: number) => Promise<Page<T>>,
  options: WalkOptions = {},
): AsyncGenerator<T, void, undefined> {
  const startPage = options.startPage ?? 1;
  const maxPages = options.maxPages ?? 1000;
  const getKey = options.getKey as
    | ((item: T) => string | number | undefined)
    | undefined;
  const seen = new Set<string | number>();

  for (let page = startPage; page < startPage + maxPages; page++) {
    const { items, totalPage } = await fetchPage(page);
    let fresh = 0;

    for (const item of items) {
      if (getKey) {
        const key = getKey(item);
        if (key !== undefined) {
          if (seen.has(key)) continue;
          seen.add(key);
        }
      }
      fresh++;
      yield item;
    }

    if (totalPage !== null) {
      if (page >= totalPage) return;
    } else if (fresh === 0) {
      return;
    }
  }
}

/** Drain an async iterable into an array. */
export async function collect<T>(
  source: AsyncIterable<T>,
): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}
