import {
  Requester,
  SuzukiError,
  SuzukiApiError,
  SuzukiSessionExpiredError,
  isRecord,
  joinUrl,
  normalizeBaseUrl,
  walkPages,
  collect,
  type FetchLike,
  type RawResponse,
} from "../shared/index.js";
import type {
  Epart,
  Figure,
  FigureDetail,
  FigureDetailOptions,
  FiguresData,
  Hotspot,
  OtherPartType,
  ParsedPosition,
  PartTag,
  PreviewTag,
  ListFiguresParams,
  ListPreviewTagsParams,
  ListVehiclesParams,
  RequestOptions,
  VehicleOption,
  VehiclesData,
  WalkFiguresParams,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api-web-corp.suzuki.co.id";
const BASE_PATH = "/api/v1/eparts";

const DEFAULT_HEADERS: Record<string, string> = {
  accept: "application/json",
  "accept-language": "en-US,en;q=0.9,id-ID;q=0.8,id;q=0.7",
  origin: "https://www.suzuki.co.id",
  referer: "https://www.suzuki.co.id/",
};

export interface EpartsClientOptions {
  /** Default: `https://api-web-corp.suzuki.co.id`. */
  baseUrl?: string;
  /** Custom fetch implementation. Default: global `fetch`. */
  fetch?: FetchLike;
  /** Merged over the defaults (accept, accept-language, origin, referer). */
  headers?: Record<string, string>;
  /** Called before every attempt; returned headers are merged last. */
  auth?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Per-attempt timeout in ms. Default `30000`. `0` disables. */
  timeoutMs?: number;
  /** Attempts after the first one (network errors, 429, 5xx). Default `2`. */
  maxRetries?: number;
  /** First backoff delay in ms. Default `300`. */
  retryBaseDelayMs?: number;
  /** Backoff ceiling in ms. Default `5000`. */
  retryMaxDelayMs?: number;
  /** Resolve HTTP 404 to an empty value instead of throwing. Default `false`. */
  treatNotFoundAsEmpty?: boolean;
}

function isSuccessCode(code: unknown): boolean {
  return (
    code === undefined ||
    code === 0 ||
    code === 200 ||
    code === "0" ||
    code === "200"
  );
}

function isAuthCode(code: unknown): boolean {
  return code === 401 || code === 403 || code === "401" || code === "403";
}

/**
 * Client for the Suzuki Indonesia e-Parts catalog (suzuki.co.id).
 *
 * This is the richer of the two catalogs in this package: it exposes figure
 * *hotspot coordinates* (`position_x` / `position_y`), which is what makes
 * clickable overlays on exploded-view diagrams possible. See
 * {@link EpartsClient.catalog}.
 *
 * ```ts
 * const client = new EpartsClient();
 * const types = await client.partTypes.list();
 * const { options } = await client.vehicles.list({ type: "4-wheels" });
 * for await (const fig of client.figures.iterate({ vehicleId: 95, typeSlug: "engine" })) {
 *   const detail = await client.catalog.figureDetail(fig.id, { figure: fig });
 * }
 * ```
 */
export class EpartsClient {
  readonly partTypes: PartTypesResource;
  readonly vehicles: VehiclesResource;
  readonly previewTags: PreviewTagsResource;
  readonly figures: FiguresResource;
  readonly partTags: PartTagsResource;
  readonly parts: PartsResource;
  readonly catalog: CatalogResource;

  private readonly requester: Requester;
  private readonly baseUrl: string;
  private readonly treatNotFoundAsEmpty: boolean;

  constructor(options: EpartsClientOptions = {}) {
    const fetchImpl =
      options.fetch ??
      (typeof fetch === "function" ? fetch.bind(globalThis) : undefined);
    if (!fetchImpl) {
      throw new SuzukiError(
        "No fetch implementation available; pass options.fetch",
      );
    }

    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.treatNotFoundAsEmpty = options.treatNotFoundAsEmpty ?? false;
    this.requester = new Requester({
      fetch: fetchImpl,
      headers: { ...DEFAULT_HEADERS, ...(options.headers ?? {}) },
      auth: options.auth,
      timeoutMs: options.timeoutMs ?? 30_000,
      maxRetries: Math.max(0, options.maxRetries ?? 2),
      retryBaseDelayMs: options.retryBaseDelayMs ?? 300,
      retryMaxDelayMs: options.retryMaxDelayMs ?? 5_000,
    });

    const get = this.get.bind(this);
    this.partTypes = new PartTypesResource(get);
    this.vehicles = new VehiclesResource(get);
    this.previewTags = new PreviewTagsResource(get);
    this.figures = new FiguresResource(get);
    this.partTags = new PartTagsResource(get);
    this.parts = new PartsResource(get);
    this.catalog = new CatalogResource(this.parts, this.partTags);
  }

  /**
   * GET + envelope unwrap.
   *
   * `emptyValue` is returned for HTTP 404 when `treatNotFoundAsEmpty` is on.
   */
  private async get<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined>,
    emptyValue: T,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = joinUrl(this.baseUrl, path, query);
    const raw = await this.requester.get(url, options.signal);
    if (raw.status === 404 && this.treatNotFoundAsEmpty) return emptyValue;
    return unwrapEnvelope<T>(raw, url);
  }
}

/** Validate the e-Parts envelope and return its `data` payload. */
function unwrapEnvelope<T>(raw: RawResponse, url: string): T {
  const body = isRecord(raw.json) ? raw.json : undefined;
  const code =
    body && (typeof body.code === "number" || typeof body.code === "string")
      ? body.code
      : undefined;
  const requestId =
    body && typeof body.request_id === "string" ? body.request_id : undefined;
  const message =
    body && typeof body.message === "string"
      ? body.message
      : `HTTP ${raw.status}`;

  const details = {
    url,
    httpStatus: raw.status,
    code,
    requestId,
    body: body ?? raw.text,
  };

  if (raw.status === 401 || raw.status === 403 || isAuthCode(code)) {
    throw new SuzukiSessionExpiredError(message, details);
  }
  if (!raw.ok) throw new SuzukiApiError(message, details);
  if (!body)
    throw new SuzukiApiError("Response was not a JSON object", details);
  if (body.status !== "success" || !isSuccessCode(code)) {
    throw new SuzukiApiError(message, details);
  }
  return body.data as T;
}

type Getter = <T>(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
  emptyValue: T,
  options?: RequestOptions,
) => Promise<T>;

class PartTypesResource {
  constructor(private readonly get: Getter) {}

  /** GET /other-part-types/index */
  list(options?: RequestOptions): Promise<OtherPartType[]> {
    return this.get<OtherPartType[]>(
      `${BASE_PATH}/other-part-types/index`,
      {},
      [],
      options,
    );
  }

  /** Iterate over all part types, stopping when a page yields no new ids. */
  iterate(
    options?: WalkFiguresParams,
  ): AsyncGenerator<OtherPartType, void, undefined> {
    return walkPages<OtherPartType>(
      async (page: number) => {
        const data = await this.get<OtherPartType[]>(
          `${BASE_PATH}/other-part-types/index`,
          { page },
          [],
        );
        return { items: data, totalPage: null };
      },
      {
        startPage: options?.startPage,
        maxPages: options?.maxPages,
        getKey: (item: OtherPartType) => item.id,
      },
    );
  }

  /** Collect all part types into a normalized shape. */
  listAll(options?: WalkFiguresParams): Promise<{
    data: OtherPartType[];
    summary: {
      total_show: number;
      total_filter: number;
      total_data: number;
    };
    pagination: {
      page: number;
      per_page: number;
      total_page: number | null;
    };
  }> {
    return collect(this.iterate(options)).then((items) => ({
      data: items,
      summary: {
        total_show: items.length,
        total_filter: items.length,
        total_data: items.length,
      },
      pagination: {
        page: options?.startPage ?? 1,
        per_page: items.length,
        total_page: null,
      },
    }));
  }
}

class VehiclesResource {
  constructor(private readonly get: Getter) {}

  /** GET /vehicles/ajax/vehicles?type=&return=&vehicle= */
  list(params: ListVehiclesParams): Promise<VehiclesData> {
    return this.get<VehiclesData>(
      `${BASE_PATH}/vehicles/ajax/vehicles`,
      {
        type: params.type,
        return: params.returnKey ?? "slug",
        vehicle: params.vehicle,
      },
      { options: [] as VehicleOption[], type: params.type },
      params,
    );
  }

  /** Iterate over all vehicle options, stopping when a page yields no new ids. */
  iterate(
    options?: WalkFiguresParams,
  ): AsyncGenerator<VehicleOption, void, undefined> {
    return walkPages<VehicleOption>(
      async (page: number) => {
        const data = await this.get<VehiclesData>(
          `${BASE_PATH}/vehicles/ajax/vehicles`,
          { page },
          {} as VehiclesData,
        );
        return { items: data.options, totalPage: null };
      },
      {
        startPage: options?.startPage,
        maxPages: options?.maxPages,
        getKey: (option: VehicleOption) => option.value,
      },
    );
  }

  /** Collect all vehicle options into a normalized shape. */
  async listAll(options?: WalkFiguresParams): Promise<{
    data: VehicleOption[];
    summary: {
      total_show: number;
      total_filter: number;
      total_data: number;
    };
    pagination: {
      page: number;
      per_page: number;
      total_page: number | null;
    };
  }> {
    return collect(this.iterate(options)).then((items) => ({
      data: items,
      summary: {
        total_show: items.length,
        total_filter: items.length,
        total_data: items.length,
      },
      pagination: {
        page: options?.startPage ?? 1,
        per_page: items.length,
        total_page: null,
      },
    }));
  }
}

class PreviewTagsResource {
  constructor(private readonly get: Getter) {}

  /** GET /preview-tag?id= */
  list(params: ListPreviewTagsParams): Promise<PreviewTag[]> {
    return this.get<PreviewTag[]>(
      `${BASE_PATH}/preview-tag`,
      { id: params.vehicleId },
      [],
      params,
    );
  }

  /** Iterate over all preview tags, stopping when a page yields no new ids. */
  iterate(
    options?: WalkFiguresParams,
  ): AsyncGenerator<PreviewTag, void, undefined> {
    return walkPages<PreviewTag>(
      async (page: number) => {
        const data = await this.get<PreviewTag[]>(
          `${BASE_PATH}/preview-tag`,
          { page },
          [],
        );
        return { items: data, totalPage: null };
      },
      {
        startPage: options?.startPage,
        maxPages: options?.maxPages,
        getKey: (tag: PreviewTag) => tag.id,
      },
    );
  }

  /** Collect all preview tags into a normalized shape. */
  async listAll(options?: WalkFiguresParams): Promise<{
    data: PreviewTag[];
    summary: {
      total_show: number;
      total_filter: number;
      total_data: number;
    };
    pagination: {
      page: number;
      per_page: number;
      total_page: number | null;
    };
  }> {
    return collect(this.iterate(options)).then((items) => ({
      data: items,
      summary: {
        total_show: items.length,
        total_filter: items.length,
        total_data: items.length,
      },
      pagination: {
        page: options?.startPage ?? 1,
        per_page: items.length,
        total_page: null,
      },
    }));
  }
}

class FiguresResource {
  constructor(private readonly get: Getter) {}

  /** GET /figures/ajax — a single page. */
  list(params: ListFiguresParams): Promise<FiguresData> {
    const page = params.page ?? 1;
    return this.get<FiguresData>(
      `${BASE_PATH}/figures/ajax`,
      {
        type_slug: params.typeSlug,
        vehicle_id: params.vehicleId,
        keyword: params.keyword,
        page,
        sort: params.sort,
      },
      {
        figures: [],
        page: String(page),
        paging: "",
        type: { id: 0, slug: params.typeSlug, name: "" },
        vehicle: { id: Number(params.vehicleId), slug: "", name: "" },
      },
      params,
    );
  }

  /**
   * Yield every figure for a vehicle/type, page by page.
   *
   * e-Parts reports no page count, so this stops at the first page that
   * contributes no new figure id (which also guards against a server that
   * ignores `page`), or at `maxPages`.
   */
  iterate(params: WalkFiguresParams): AsyncGenerator<Figure, void, undefined> {
    return walkPages<Figure>(
      async (page) => {
        const data = await this.list({ ...params, page });
        return { items: data.figures, totalPage: null };
      },
      {
        startPage: params.startPage,
        maxPages: params.maxPages,
        getKey: (figure: Figure) => figure.id,
      },
    );
  }

  /** Collect {@link FiguresResource.iterate} into an array. */
  listAll(params: WalkFiguresParams): Promise<Figure[]> {
    return collect(this.iterate(params));
  }
}

class PartTagsResource {
  constructor(private readonly get: Getter) {}

  /** GET /part-tags/figure/detail?figure_id= */
  listByFigure(
    figureId: number | string,
    options?: RequestOptions,
  ): Promise<PartTag[]> {
    return this.get<PartTag[]>(
      `${BASE_PATH}/part-tags/figure/detail`,
      { figure_id: figureId },
      [],
      options,
    );
  }
}

class PartsResource {
  constructor(private readonly get: Getter) {}

  /** GET /parts/figure/detail?figure_id= */
  listByFigure(
    figureId: number | string,
    options?: RequestOptions,
  ): Promise<Epart[]> {
    return this.get<Epart[]>(
      `${BASE_PATH}/parts/figure/detail`,
      { figure_id: figureId },
      [],
      options,
    );
  }

  /** GET /parts/figure/detail/table?id= — returns an HTML fragment. */
  getDetailTable(
    partId: number | string,
    options?: RequestOptions,
  ): Promise<string> {
    return this.get<string>(
      `${BASE_PATH}/parts/figure/detail/table`,
      { id: partId },
      "",
      options,
    );
  }
}

/**
 * Joins the two figure endpoints into one overlay-ready payload.
 *
 * `parts.listByFigure` and `partTags.listByFigure` are two separate calls; the
 * tags carry the coordinates and the parts carry the catalogue data. This
 * resource fetches both concurrently and zips them on `part_id`, which is the
 * shape a UI actually needs to place markers on the figure image.
 */
class CatalogResource {
  constructor(
    private readonly parts: PartsResource,
    private readonly partTags: PartTagsResource,
  ) {}

  /**
   * Everything needed to render a clickable exploded-view diagram.
   *
   * Makes two parallel requests and returns the parts joined to their hotspot
   * positions. Pass the `figure` you already have (from `figures.list()` or
   * `figures.iterate()`) to also get `imageUrl` without another round-trip —
   * e-Parts has no "fetch figure by id" endpoint.
   *
   * ```ts
   * const figure = (await client.figures.list({ vehicleId: 95, typeSlug: "engine" })).figures[0];
   * const detail = await client.catalog.figureDetail(figure.id, { figure });
   * // detail.hotspots -> [{ tagNo: "1", position: { x: 12.5, y: 40 }, part }, ...]
   * ```
   */
  async figureDetail(
    figureId: number | string,
    options: FigureDetailOptions = {},
  ): Promise<FigureDetail> {
    const [parts, tags] = await Promise.all([
      this.parts.listByFigure(figureId, options),
      this.partTags.listByFigure(figureId, options),
    ]);

    const partsById = new Map<string, Epart>();
    for (const part of parts) partsById.set(String(part.id), part);

    const taggedPartIds = new Set<string>();
    const hotspots: Hotspot[] = tags.map((tag) => {
      const key = String(tag.part_id);
      const part = partsById.get(key);
      if (part) taggedPartIds.add(key);
      return {
        tag,
        tagNo: tag.tag_no,
        position: parsePosition(tag),
        part,
      };
    });

    return {
      figureId: String(figureId),
      imageUrl:
        options.figure?.cdn_file_url || options.figure?.file_url || null,
      parts,
      hotspots,
      untaggedParts: parts.filter(
        (part) => !taggedPartIds.has(String(part.id)),
      ),
    };
  }
}

/**
 * Read a tag's `position_x` / `position_y` as numbers.
 *
 * The values are numeric strings and appear to be percentages of the image
 * dimensions, but the API does not document the unit — so the raw strings are
 * preserved alongside the parsed numbers. Returns `null` when a tag has no
 * position or it is unparseable.
 */
export function parsePosition(
  tag: Pick<PartTag, "position_x" | "position_y">,
): ParsedPosition | null {
  const rawX = tag.position_x ?? "";
  const rawY = tag.position_y ?? "";
  const x = toCoordinate(rawX);
  const y = toCoordinate(rawY);
  if (x === null && y === null) return null;
  return { rawX, rawY, x, y };
}

/**
 * `Number("")` is `0`, which would silently pin a marker to the top-left
 * corner, so blank values are treated as "no coordinate" instead.
 */
function toCoordinate(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}
