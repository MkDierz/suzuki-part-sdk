/**
 * MySuzuki catalog (mysuzuki.id).
 *
 * Richer part metadata than e-Parts (pricing, stock, weights, applicable
 * vehicles) but **no figure coordinates** — use `@mkdierz/suzuki-parts-sdk/eparts`
 * when you need clickable overlays.
 *
 * ```ts
 * import { MySuzukiClient } from "@mkdierz/suzuki-parts-sdk/mysuzuki";
 * ```
 */
export { MySuzukiClient } from "./client.js";
export type { MySuzukiClientOptions } from "./client.js";

export { emptyPage, formatRupiah } from "./helpers.js";

export { MYSUZUKI_BASE_URLS, MYSUZUKI_CODES } from "./types.js";

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
} from "./types.js";

/**
 * @deprecated Import from `@mkdierz/suzuki-parts-sdk` instead — errors
 * are shared across both clients so one `instanceof` check catches everything.
 */
export {
  SuzukiError,
  SuzukiApiError,
  SuzukiSessionExpiredError,
  SuzukiNetworkError,
} from "../shared/errors.js";
