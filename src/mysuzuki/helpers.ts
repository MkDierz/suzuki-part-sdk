import type { Paginated } from "./types.js";

/**
 * A synthetic empty page.
 *
 * MySuzuki answers `404` (not an empty list) when a filter matches nothing, so
 * `notFoundAsEmpty` substitutes this to keep iteration working.
 */
export function emptyPage<T>(page: number, perPage: number): Paginated<T> {
  return {
    data: [],
    summary: { total_show: 0, total_filter: 0, total_data: 0 },
    pagination: { page, per_page: perPage, total_page: 0 },
  };
}

/** Format an amount as Indonesian rupiah, e.g. `Rp 1.025.500`. */
export function formatRupiah(amount: number): string {
  return `Rp ${Math.round(amount).toLocaleString("id-ID")}`;
}
