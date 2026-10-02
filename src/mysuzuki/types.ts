/**
 * Wire types for the MySuzuki API (mysuzuki.id).
 *
 * Two behaviours of this API are easy to get wrong, so they are called out
 * here and handled by the client:
 *
 * 1. **HTTP is always 200.** The real status lives in the envelope's `code`
 *    field: `200` ok, `404` not found / nothing to return, `498` session
 *    expired. Checking `response.ok` is meaningless here.
 * 2. **Numeric-looking fields are strings** (`quantity: "1"`,
 *    `price_diskon: "0"`). Types mirror that exactly — parse explicitly.
 */

export const MYSUZUKI_BASE_URLS = {
  /** Vehicles, categories, figures, parts. */
  commerce: "https://api2-commerce.mysuzuki.id",
  /** Genuine-part categories. */
  core: "https://apinew.mysuzuki.id",
} as const;

/** The authoritative status codes for this API, all delivered inside HTTP 200. */
export const MYSUZUKI_CODES = {
  OK: 200,
  NOT_FOUND: 404,
  SESSION_EXPIRED: 498,
} as const;

export type VehicleTypeCode = "2-wheels" | "4-wheels" | "marine";

/** Standard response wrapper for every endpoint. */
export interface MySuzukiEnvelope<T> {
  code: number;
  message: string;
  response?: T;
}

export interface ListSummary {
  total_show: number;
  total_filter: number;
  total_data: number;
}

export interface Pagination {
  page: number;
  per_page: number;
  total_page: number;
}

export interface Paginated<T> {
  data: T[];
  summary: ListSummary;
  pagination: Pagination;
}

/** GET api2-commerce /vehicle */
export interface Vehicle {
  id: string;
  parent_id: string | null;
  type_id: string;
  name: string;
  slug: string;
  image: string | null;
  year: string;
  number_vin: string;
  status_featured: string;
  status_active: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  epart_id: string | null;
  type_code: VehicleTypeCode;
  type_name: string;
  /** Absent on some records (e.g. marine). */
  file_image?: string;
}

/** GET api2-commerce /category?type_id= — spare-part groups ("Engine", ...). */
export interface PartCategory {
  id: string;
  group_type: string;
  group_id: string;
  name: string;
  slug: string | null;
  image: string;
  created_at: string;
  updated_at: string;
  status_active: string;
  in_website: string | null;
  position: string;
  type_id: string;
}

/** GET apinew /category — top-level shop categories, e.g. "Genuine Part". */
export interface GenuinePartCategory {
  id: string;
  name: string;
  image: string;
  slug: string;
}

/** GET api2-commerce /figure — one exploded-view diagram. */
export interface MysuzukiFigure {
  id: string;
  vehicle_id: string;
  category_id: string;
  name: string;
  description: string | null;
  image: string;
  sort_order: string | null;
  created_at: string;
  updated_at: string;
  status_active: string;
  group_type: string;
  file_image: string;
}

/** A vehicle a part applies to, denormalised into the part row. */
export interface PartVehicleRef {
  id: string;
  type_id: string;
  type_code: VehicleTypeCode;
  type_name: string;
  name: string;
  image: string | null;
}

/** GET api2-commerce /part */
export interface MysuzukiPart {
  id: string;
  figure_id: string;
  category_id: string;
  type_id: string;
  origin_id: string;
  origin_parent_id: string | null;
  name: string;
  description: string | null;
  image: string | null;
  /** String on the wire, e.g. `"1"`. */
  quantity: string;
  /** Price in IDR (integer rupiah). */
  price: number;
  /** String on the wire, e.g. `"0"`. */
  price_diskon: string;
  price_usd: number;
  remarks: string;
  number_part: string;
  number_sub_part: string;
  number_tag: string;
  number_complete: string | null;
  created_at: string;
  updated_at: string;
  weight_original: number;
  weight_shipping: number;
  status_active: string;
  status_promo: string;
  status_sarp: string;
  status_ecstar: string;
  status_image: string;
  status_flag: string;
  /** Observed: `"ready"`. Other values are possible. */
  status_stock: string;
  dim_length: number;
  dim_width: number;
  dim_height: number;
  /** Note the API's own spelling. */
  recomended: string;
  saleable: string;
  air: string;
  import: string | null;
  min_dcs: string;
  sync_date: string | null;
  group_type: string;
  popularity: string;
  category_name: string;
  figure_name: string;
  figure_image: string;
  status_wishlist: string;
  file_figure_image: string;
  images: unknown[] | null;
  vehicles: PartVehicleRef[];
  volume_weight_gram: number;
  volume_weight_kg: number;
}

// ---------------------------------------------------------------------------
// Request params (camelCase here -> snake_case on the wire)
// ---------------------------------------------------------------------------

export interface PageParams {
  /** 1-based page number. */
  page?: number;
  /** Page size. The website uses 10, 24 and 1000. */
  length?: number;
  /** Free-text name filter. */
  name?: string;
  signal?: AbortSignal;
}

export interface VehicleListParams extends PageParams {
  /** Wire: `type_code`. */
  typeCode?: VehicleTypeCode;
}

export interface PartCategoryListParams extends PageParams {
  /** Wire: `type_id` — the `type_id` from a {@link Vehicle}. */
  typeId: string;
}

export interface FigureListParams extends PageParams {
  /** Wire: `vehicle_id`. */
  vehicleId: string;
  /** Wire: `category_id`. */
  categoryId?: string;
}

export interface PartListParams extends PageParams {
  /** Wire: `vehicle_id`. */
  vehicleId?: string;
  /** Wire: `figure_id`. */
  figureId?: string;
  /** Wire: `recomended` (sic). */
  recommended?: boolean;
}
