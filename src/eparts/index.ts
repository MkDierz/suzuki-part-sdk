/**
 * Suzuki Indonesia e-Parts catalog (suzuki.co.id).
 *
 * The overlay-friendly catalog: figure hotspots carry `position_x` /
 * `position_y`, which this module exposes through `catalog.figureDetail`.
 *
 * ```ts
 * import { EpartsClient } from "@mkdierz/suzuki-indo-parts-sdk/eparts";
 * ```
 */
export { EpartsClient, parsePosition } from "./client.js";
export type { EpartsClientOptions } from "./client.js";

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
  RequestOptions,
  SubPart,
  VehicleOption,
  VehicleType,
  VehiclesData,
  WalkFiguresParams,
} from "./types.js";

/**
 * @deprecated Import from `@mkdierz/suzuki-indo-parts-sdk` instead — errors
 * are shared across both clients so one `instanceof` check catches everything.
 */
export {
  SuzukiError,
  SuzukiApiError as ApiError,
  SuzukiSessionExpiredError as SessionExpiredError,
  SuzukiNetworkError as NetworkError,
} from "../shared/errors.js";
