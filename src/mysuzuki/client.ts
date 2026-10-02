import {
  Requester,
  SuzukiApiError,
  SuzukiSessionExpiredError,
  SuzukiError,
  collect,
  isRecord,
  sleep,
  walkPages,
  type FetchLike,
  type RawResponse,
} from "../shared/index.js";
import { emptyPage } from "./helpers.js";
import {
  MYSUZUKI_BASE_URLS,
  MYSUZUKI_CODES,
  type FigureListParams,
  type GenuinePartCategory,
  type MysuzukiFigure,
  type MysuzukiPart,
  type MySuzukiEnvelope,
  type PageParams,
  type Paginated,
  type PartCategory,
  type PartCategoryListParams,
  type PartListParams,
  type Vehicle,
  type VehicleListParams,
} from "./types.js";

export interface MySuzukiClientOptions {
  /** Override hosts (e.g. for a proxy or tests). */
  baseUrls?: Partial<typeof MYSUZUKI_BASE_URLS>;
  /** Custom fetch implementation. Default: global `fetch`. */
  fetch?: FetchLike;
  /** Extra headers on every request, merged over the defaults. */
  headers?: Record<string, string>;
  /** Per-request timeout in ms. Default `15000`. */
  timeoutMs?: number;
  /** Attempts after the first one. Default `2`. */
  retries?: number;
  /** First backoff delay in ms, doubling each attempt. Default `300`. */
  retryDelayMs?: number;
  /** Backoff ceiling in ms. Default `5000`. */
  retryMaxDelayMs?: number;
  /**
   * Turn envelope code `404` on list endpoints into an empty page instead of
   * throwing. Default `true`, matching how the website behaves.
   */
  notFoundAsEmpty?: boolean;
}

type QueryValue = string | number | boolean | null | undefined;

interface CallOptions {
  base: string;
  path: string;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

/**
 * Client for the MySuzuki API (mysuzuki.id).
 *
 * This catalog exposes richer part metadata than e-Parts (pricing, stock
 * status, weights, applicable vehicles) but **no figure coordinates** — if you
 * need clickable overlays, use {@link EpartsClient} from this package instead.
 *
 * ```ts
 * const suzuki = new MySuzukiClient();
 * const bikes = await suzuki.vehicles.list({ typeCode: "2-wheels", length: 100 });
 * const parts = await suzuki.parts.list({ figureId: "aa76a906..." });
 * ```
 */
export class MySuzukiClient {
  private readonly urls: typeof MYSUZUKI_BASE_URLS;
  private readonly requester: Requester;
  private readonly notFoundAsEmpty: boolean;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(options: MySuzukiClientOptions = {}) {
    this.urls = { ...MYSUZUKI_BASE_URLS, ...options.baseUrls };
    this.notFoundAsEmpty = options.notFoundAsEmpty ?? true;
    this.maxRetries = Math.max(0, options.retries ?? 2);
    this.retryDelayMs = options.retryDelayMs ?? 300;

    const fetchImpl =
      options.fetch ??
      (typeof fetch === "function" ? fetch.bind(globalThis) : undefined);
    if (!fetchImpl) {
      throw new SuzukiError(
        "No fetch implementation available; pass options.fetch",
      );
    }

    this.requester = new Requester({
      fetch: fetchImpl,
      headers: {
        accept: "application/json, text/plain, */*",
        // Browsers silently drop these two; Node/Bun/Deno send them.
        origin: "https://www.mysuzuki.id",
        referer: "https://www.mysuzuki.id/",
        ...(options.headers ?? {}),
      },
      timeoutMs: options.timeoutMs ?? 15_000,
      maxRetries: this.maxRetries,
      retryBaseDelayMs: this.retryDelayMs,
      retryMaxDelayMs: options.retryMaxDelayMs ?? 5_000,
    });
  }

  /** Vehicles: motorcycles, cars, marine engines. */
  readonly vehicles = {
    list: (params: VehicleListParams = {}): Promise<Paginated<Vehicle>> =>
      this.listCall<Vehicle>(this.urls.commerce, "/vehicle", {
        type_code: params.typeCode,
        ...pageQuery(params),
      }, params),

    /** Every page, collected into one array. */
    listAll: (params: VehicleListParams = {}): Promise<Vehicle[]> =>
      collect(this.vehicles.iterate(params)),

    iterate: (params: VehicleListParams = {}) =>
      walkPages<Vehicle>(
        async (page) => {
          const result = await this.vehicles.list({ ...params, page });
          return {
            items: result.data,
            totalPage: result.pagination.total_page,
          };
        },
      ),

    /** Look a vehicle up by slug (e.g. `"access-125"`) within a type. */
    findBySlug: async (
      slug: string,
      typeCode?: VehicleListParams["typeCode"],
    ): Promise<Vehicle | undefined> => {
      const all = await this.vehicles.listAll({ typeCode, length: 1000 });
      return all.find((vehicle) => vehicle.slug === slug);
    },
  };

  /** Spare-part groups for a vehicle type ("Engine", "Electrical", ...). */
  readonly categories = {
    list: (
      params: PartCategoryListParams,
    ): Promise<Paginated<PartCategory>> =>
      this.listCall<PartCategory>(this.urls.commerce, "/category", {
        type_id: params.typeId,
        ...pageQuery(params),
      }, params),

    listAll: (params: PartCategoryListParams): Promise<PartCategory[]> =>
      collect(this.categories.iterate(params)),

    iterate: (params: PartCategoryListParams) =>
      walkPages<PartCategory>(
        async (page) => {
          const result = await this.categories.list({ ...params, page });
          return {
            items: result.data,
            totalPage: result.pagination.total_page,
          };
        },
      ),
  };

  /** Exploded-view diagrams ("FIG.1 CYLINDER HEAD") per vehicle. */
  readonly figures = {
    list: (params: FigureListParams): Promise<Paginated<MysuzukiFigure>> =>
      this.listCall<MysuzukiFigure>(this.urls.commerce, "/figure", {
        category_id: params.categoryId,
        vehicle_id: params.vehicleId,
        ...pageQuery(params),
      }, params),

    listAll: (params: FigureListParams): Promise<MysuzukiFigure[]> =>
      collect(this.figures.iterate(params)),

    iterate: (params: FigureListParams) =>
      walkPages<MysuzukiFigure>(
        async (page) => {
          const result = await this.figures.list({ ...params, page });
          return {
            items: result.data,
            totalPage: result.pagination.total_page,
          };
        },
      ),
  };

  /** Spare parts, by figure or by vehicle. */
  readonly parts = {
    list: (params: PartListParams): Promise<Paginated<MysuzukiPart>> => {
      if (!params.vehicleId && !params.figureId) {
        throw new TypeError("parts.list requires vehicleId and/or figureId");
      }
      return this.listCall<MysuzukiPart>(this.urls.commerce, "/part", {
        vehicle_id: params.vehicleId,
        figure_id: params.figureId,
        // "recomended" is the API's own spelling.
        recomended: params.recommended === undefined
          ? undefined
          : params.recommended
            ? 1
            : 0,
        ...pageQuery(params),
      }, params);
    },

    listAll: (params: PartListParams): Promise<MysuzukiPart[]> =>
      collect(this.parts.iterate(params)),

    iterate: (params: PartListParams) =>
      walkPages<MysuzukiPart>(
        async (page) => {
          const result = await this.parts.list({ ...params, page });
          return {
            items: result.data,
            totalPage: result.pagination.total_page,
          };
        },
      ),
  };

  /** Top-level shop categories on the core host (e.g. "Genuine Part"). */
  readonly genuineParts = {
    categories: (options: { signal?: AbortSignal } = {}) =>
      this.call<{ data: GenuinePartCategory[] }>({
        base: this.urls.core,
        path: "/category",
        signal: options.signal,
      }).then((res) => res?.data ?? []),
  };

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** A list call, where envelope code 404 becomes an empty page. */
  private async listCall<T>(
    base: string,
    path: string,
    query: Record<string, QueryValue>,
    params: PageParams,
  ): Promise<Paginated<T>> {
    try {
      const res = await this.call<Paginated<T>>({
        base,
        path,
        query,
        signal: params.signal,
      });
      if (!res) throw new Error("Empty response");
      return res;
    } catch (error) {
      if (
        this.notFoundAsEmpty &&
        error instanceof SuzukiApiError &&
        error.code === MYSUZUKI_CODES.NOT_FOUND
      ) {
        return emptyPage<T>(params.page ?? 1, params.length ?? 10);
      }
      throw error;
    }
  }

  /**
   * One request: build the URL, GET it, and unwrap the envelope.
   *
   * MySuzuki always answers HTTP 200, so the *envelope* code is what decides
   * success — including server-side failures (`code >= 500`), which this
   * retries just like an HTTP 5xx.
   */
  private async call<T>(
    options: CallOptions,
    attempt = 0,
  ): Promise<T | undefined> {
    const url = new URL(options.path, options.base);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(
        key,
        typeof value === "boolean" ? (value ? "1" : "0") : String(value),
      );
    }
    const href = url.toString();
    const raw: RawResponse = await this.requester.get(href, options.signal);

    if (raw.status === 401 || raw.status === 403) {
      throw new SuzukiSessionExpiredError(
        `Unauthorized (HTTP ${raw.status})`,
        { url: href, httpStatus: raw.status, body: raw.text },
      );
    }

    if (!isRecord(raw.json)) {
      throw new SuzukiApiError(
        raw.json === undefined
          ? `Invalid JSON (HTTP ${raw.status}) from ${href}`
          : `Unexpected response shape from ${href}`,
        { url: href, httpStatus: raw.status, body: raw.text },
      );
    }

    const body = raw.json as unknown as MySuzukiEnvelope<T>;
    if (typeof body?.code !== "number") {
      throw new SuzukiApiError(
        `Unexpected response shape from ${href}`,
        { url: href, httpStatus: raw.status, body: raw.json },
      );
    }

    if (body.code === MYSUZUKI_CODES.OK) return body.response;
    if (body.code === MYSUZUKI_CODES.SESSION_EXPIRED) {
      throw new SuzukiSessionExpiredError(body.message ?? "Session expired", {
        url: href,
        httpStatus: raw.status,
        code: body.code,
        body: raw.json,
      });
    }

    // Server-side failures arrive as HTTP 200 with an envelope code >= 500.
    // Retry them the way an HTTP 5xx would be retried; the requester has
    // already exhausted HTTP-level retries by this point.
    if (body.code >= 500 && attempt < this.maxRetries) {
      await sleep(this.retryDelayMs * 2 ** attempt);
      return this.call<T>(options, attempt + 1);
    }

    throw new SuzukiApiError(
      `${body.message} (code ${body.code})`,
      {
        url: href,
        httpStatus: raw.status,
        code: body.code,
        requestId: undefined,
        body: raw.json,
      },
    );
  }
}

function pageQuery(params: PageParams): Record<string, QueryValue> {
  return { page: params.page, length: params.length, name: params.name };
}
