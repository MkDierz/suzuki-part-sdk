/**
 * `@mkdierz/suzuki-parts-sdk`
 *
 * Unofficial, dependency-free TypeScript clients for the two Suzuki Indonesia
 * parts catalogs. Both reverse-engineered from captured request logs.
 *
 * | Client | Catalog | Coordinates? |
 * |--------|---------|--------------|
 * | {@link EpartsClient} | suzuki.co.id e-Parts | **yes** — `position_x` / `position_y` |
 * | {@link MySuzukiClient} | mysuzuki.id | no |
 *
 * For clickable overlays on exploded-view diagrams use {@link EpartsClient};
 * for richer part metadata (price, stock, weights) use {@link MySuzukiClient}.
 *
 * ```ts
 * import { EpartsClient, SuzukiError } from "@mkdierz/suzuki-parts-sdk";
 *
 * const client = new EpartsClient();
 * const { options } = await client.vehicles.list({ type: "4-wheels" });
 * ```
 *
 * Subpath imports are available for tree-shaking and to keep names explicit:
 *
 * ```ts
 * import { EpartsClient } from "@mkdierz/suzuki-parts-sdk/eparts";
 * import { MySuzukiClient } from "@mkdierz/suzuki-parts-sdk/mysuzuki";
 * ```
 */

// --- Clients ----------------------------------------------------------------
export { EpartsClient, parsePosition } from "./eparts/client.js";
export type { EpartsClientOptions } from "./eparts/client.js";

export { MySuzukiClient } from "./mysuzuki/client.js";
export type { MySuzukiClientOptions } from "./mysuzuki/client.js";

export { formatRupiah } from "./mysuzuki/helpers.js";
export { MYSUZUKI_BASE_URLS, MYSUZUKI_CODES } from "./mysuzuki/types.js";

// --- Shared errors ----------------------------------------------------------
export {
  SuzukiError,
  SuzukiApiError,
  SuzukiSessionExpiredError,
  SuzukiNetworkError,
} from "./shared/errors.js";
export type {
  ApiErrorDetails,
  NetworkErrorOptions,
} from "./shared/errors.js";

export type { FetchLike } from "./shared/http.js";

// --- e-Parts types ----------------------------------------------------------
// Names here are unprefixed because e-Parts is the primary catalog. Where the
// two APIs used the same name for different shapes, the MySuzuki type is
// suffixed `Mysuzuki*` instead.
export type {
  Epart,
  EpartsEnvelope,
  Figure,
  FigureDetail,
  FigureDetailOptions,
  FigureTypeRef,
  FigureVehicleRef,
  FiguresData,
  Hotspot,
  ListFiguresParams,
  ListPreviewTagsParams,
  ListVehiclesParams,
  OtherPartType,
  ParsedPosition,
  PartTag,
  PreviewTag,
  SubPart,
  VehicleOption,
  VehicleType,
  VehiclesData,
  WalkFiguresParams,
} from "./eparts/types.js";

export type { RequestOptions as EpartsRequestOptions } from "./eparts/types.js";

// --- MySuzuki types ---------------------------------------------------------
export type {
  FigureListParams,
  GenuinePartCategory,
  ListSummary,
  MysuzukiFigure,
  MysuzukiPart,
  MySuzukiEnvelope,
  PageParams,
  Paginated,
  Pagination,
  PartCategory,
  PartCategoryListParams,
  PartListParams,
  PartVehicleRef,
  Vehicle,
  VehicleListParams,
  VehicleTypeCode,
} from "./mysuzuki/types.js";
