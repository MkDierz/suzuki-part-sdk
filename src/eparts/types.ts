/**
 * Wire types for the Suzuki Indonesia e-Parts API.
 *
 * These mirror the API exactly: field names stay `snake_case` and numbers the
 * API sends as strings stay `string`. Public *parameter* types at the bottom use
 * `camelCase` and are mapped to wire names inside the client.
 */

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface EpartsEnvelope<T> {
  status: string;
  data: T;
  message: string;
  request_id: string;
  /** Never observed in the captured traffic. Assumed optional status code. */
  code?: number | string;
}

// ---------------------------------------------------------------------------
// Catalog entities
// ---------------------------------------------------------------------------

/** GET /other-part-types/index — top-level figure groups ("engine", ...). */
export interface OtherPartType {
  id: number;
  slug: string;
  name: string;
}

/** GET /vehicles/ajax/vehicles — one selectable model. */
export interface VehicleOption {
  value: string;
  label: string;
  /** Sent only for some options; the placeholder option uses `value: ""`. */
  selected?: boolean;
}

export interface VehiclesData {
  options: VehicleOption[];
  type: string;
}

/**
 * GET /preview-tag — hotspot positions for a vehicle's landing diagram.
 *
 * `position_x` / `position_y` are numeric strings (e.g. `"63.42592592592593"`)
 * that appear to be percentages of the image's width and height. That is
 * inferred from the values, not documented by the API; use
 * {@link parsePosition} rather than assuming the unit.
 */
export interface PreviewTag {
  id: number;
  vehicle_id: number;
  type_id: number;
  position_x: string;
  position_y: string;
  created_at: string;
  type_slug: string;
  type_name: string;
}

/** GET /figures/ajax — one exploded-view diagram. */
export interface Figure {
  id: number;
  name: string;
  file_url: string;
  cdn_file_url: string;
}

export interface FigureTypeRef {
  id: number;
  slug: string;
  name: string;
}

export interface FigureVehicleRef {
  id: number;
  slug: string;
  name: string;
}

export interface FiguresData {
  figures: Figure[];
  /** Echoed page number, as a string. */
  page: string;
  /** Opaque (pagination markup in the original UI); empty in the capture. */
  paging: string;
  type: FigureTypeRef;
  vehicle: FigureVehicleRef;
}

/**
 * GET /part-tags/figure/detail — where a part sits on a figure.
 *
 * `tag_no` and the positions are numeric strings. Rows whose `parent_id` is
 * non-zero are grouping headers and carry no part of their own.
 */
export interface PartTag {
  id: number;
  part_id: number;
  figure_id: number;
  parent_id: number;
  /** Numeric string, e.g. `"0"`. */
  tag_no: string;
  position_x: string;
  position_y: string;
  created_at: string;
  updated_at: string;
}

/** Legacy/interchange numbering for a part row. */
export interface SubPart {
  id: number;
  row_no: number;
  old_part_no: string;
  part_no: string;
  interchange_code: string;
  product_type: string;
  part_category: string;
  status_flag: string;
}

/**
 * GET /parts/figure/detail.
 *
 * `complete_no`, `description`, `created_by` and `price_perliter` were only ever
 * `null` in the capture; their non-null types are assumed.
 */
export interface Epart {
  id: number;
  figure_id: number;
  parent_id: number | null;
  part_no: string;
  complete_no: string | null;
  tag_no: string;
  name: string;
  description: string | null;
  qty: number;
  price: number;
  price_old: number;
  remarks: string;
  subpage_id: number;
  order: number;
  popup: number;
  status: number;
  created_by: number | null;
  created_at: string | null;
  updated_at: string;
  is_update_price: number;
  price_perliter: number | null;
  subpart: SubPart;
  subpart_price: number;
}

// ---------------------------------------------------------------------------
// Overlay / hotspot helpers
// ---------------------------------------------------------------------------

/** A 2D point on a figure, with the raw strings kept alongside the numbers. */
export interface ParsedPosition {
  /** `position_x` exactly as the API sent it. */
  rawX: string;
  /** `position_y` exactly as the API sent it. */
  rawY: string;
  /** `position_x` as a number, or `null` if it was absent or unparseable. */
  x: number | null;
  /** `position_y` as a number, or `null` if it was absent or unparseable. */
  y: number | null;
}

/**
 * A single overlay marker: one part tag joined to its part.
 *
 * `part` is `undefined` for grouping rows (`parent_id !== 0`), which the API
 * uses to label regions rather than to point at a specific part.
 */
export interface Hotspot {
  /** The raw tag row. */
  tag: PartTag;
  /** `tag.tag_no`, hoisted for convenience. */
  tagNo: string;
  /** Position to place the marker at, or `null` when the tag has none. */
  position: ParsedPosition | null;
  /** The part this tag points at, when there is one. */
  part: Epart | undefined;
}

export interface FigureDetail {
  /** The figure id, normalised to a string. */
  figureId: string;
  /** Background image for the overlay, if the caller supplied the figure. */
  imageUrl: string | null;
  /** Every part on the figure, in API order. */
  parts: Epart[];
  /** Tags joined to parts, in API order. */
  hotspots: Hotspot[];
  /** Parts with no tag pointing at them (rare; usually sub-parts). */
  untaggedParts: Epart[];
}

/** What {@link EpartsClient.catalog.figureDetail} needs beyond the figure id. */
export interface FigureDetailOptions {
  /**
   * The figure itself, when the caller already has it — e-Parts has no
   * "get figure by id" endpoint, so pass the object from `figures.list()` to
   * get `imageUrl` without a second round-trip.
   */
  figure?: Pick<Figure, "cdn_file_url" | "file_url">;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Request params (camelCase here -> snake_case on the wire)
// ---------------------------------------------------------------------------

/** Wire RequestOptions kept for compatibility. */
export interface RequestOptions {
  signal?: AbortSignal;
}

export interface ListVehiclesParams extends RequestOptions {
  /** Wire: `type`. */
  type: "4-wheels" | "2-wheels" | "marine";
  /** Wire: `return`. Observed: `"slug"`. */
  returnKey?: "slug" | "id";
  /** Wire: `vehicle`. Present in the capture's param set, value never seen. */
  vehicle?: string;
}

export interface ListPreviewTagsParams extends RequestOptions {
  /** Wire: `id` (vehicle id). */
  vehicleId: number | string;
}

export interface ListFiguresParams extends RequestOptions {
  /** Wire: `vehicle_id`. */
  vehicleId: number | string;
  /** Wire: `type_slug`. Observed: `"engine"`. */
  typeSlug: string;
  /** Wire: `keyword`. Value was redacted in the capture. */
  keyword?: string;
  /** Wire: `page`. 1-based. */
  page?: number;
  /** Wire: `sort`. Observed empty; allowed values unknown. */
  sort?: string;
}

export interface WalkFiguresParams extends Omit<ListFiguresParams, "page"> {
  /** First page to fetch. Default `1`. */
  startPage?: number;
  /** Safety cap on pages fetched. Default `1000`. */
  maxPages?: number;
}

export type VehicleType = ListVehiclesParams["type"];
