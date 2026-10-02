/**
 * Shared wire types used across both SDK clients.
 *
 * These mirror the API shapes captured in source_info/*.json.
 */

export interface ListSummary {
  total_show: number;
  total_filter: number;
  total_data: number;
}

export interface Pagination {
  page: number;
  per_page: number;
  total_page: number | null;
}

export interface Paginated<T> {
  data: T[];
  summary: ListSummary;
  pagination: Pagination;
}