import { SuzukiNetworkError } from "./errors.js";

/** Anything structurally compatible with the global `fetch`. */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/** Narrow an unknown value to a plain object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `sleep`, but rejects with {@link SuzukiNetworkError} if the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new SuzukiNetworkError("Request aborted", {
        cause: signal.reason,
        timedOut: false,
      }));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new SuzukiNetworkError("Request aborted", {
        cause: signal?.reason,
        timedOut: false,
      }));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Serialize a query object, skipping `undefined`. */
export function buildQueryString(
  query: Record<string, string | number | boolean | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.append(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export function joinUrl(
  baseUrl: string,
  path: string,
  query: Record<string, string | number | boolean | undefined> = {},
): string {
  return `${baseUrl}${path}${buildQueryString(query)}`;
}

/** Strip trailing slashes so path concatenation stays predictable. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** Full-jitter exponential backoff, honouring `retry-after` when present. */
export function computeBackoff(
  attempt: number,
  retryAfter: string | null | undefined,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, maxDelayMs);
    }
  }
  const ceiling = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  return Math.random() * ceiling;
}

/**
 * A response already drained to text, so callers can inspect the status for
 * retry/404 decisions without re-reading an already-consumed body.
 */
export interface RawResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
  /** Parsed JSON, or `undefined` when the body was empty or not JSON. */
  json: unknown;
}

export interface RequesterOptions {
  fetch: FetchLike;
  /** Headers merged into every request; per-request auth wins. */
  headers: Record<string, string>;
  /** Invoked before each attempt; returned headers are merged last. */
  auth?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Per-attempt timeout in ms. `0` disables the timeout. */
  timeoutMs: number;
  /** Attempts after the first one. */
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
}

/**
 * The single network seam for the whole package: URL handling, auth headers,
 * per-attempt timeouts, abort plumbing and retries on network errors /
 * 429 / 5xx.
 *
 * Envelope validation is deliberately *not* done here — each API has its own
 * envelope shape, so clients unwrap the {@link RawResponse} themselves.
 */
export class Requester {
  private readonly options: RequesterOptions;

  constructor(options: RequesterOptions) {
    this.options = options;
  }

  /**
   * GET `url`, retrying on network errors, 429 and 5xx.
   *
   * Resolves with the drained response for any status the retry layer does not
   * handle, including 404 — deciding what a 404 means is the caller's job.
   * Throws {@link SuzukiNetworkError} when the network fails or the caller's
   * signal aborts.
   */
  async get(url: string, signal?: AbortSignal): Promise<RawResponse> {
    let attempt = 0;
    for (;;) {
      try {
        const response = await this.attempt(url, signal);
        const raw = await drain(response);

        if (
          (raw.status === 429 || raw.status >= 500) &&
          attempt < this.options.maxRetries
        ) {
          await sleep(
            computeBackoff(
              attempt,
              raw.headers.get("retry-after"),
              this.options.retryBaseDelayMs,
              this.options.retryMaxDelayMs,
            ),
            signal,
          );
          attempt++;
          continue;
        }
        return raw;
      } catch (error) {
        const retryable =
          error instanceof SuzukiNetworkError && !signal?.aborted;
        if (retryable && attempt < this.options.maxRetries) {
          await sleep(
            computeBackoff(
              attempt,
              null,
              this.options.retryBaseDelayMs,
              this.options.retryMaxDelayMs,
            ),
            signal,
          );
          attempt++;
          continue;
        }
        throw error;
      }
    }
  }

  /** One attempt: no retries, no backoff. */
  private async attempt(
    url: string,
    userSignal?: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = { ...this.options.headers };
    if (this.options.auth) {
      Object.assign(headers, await this.options.auth());
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer =
      this.options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, this.options.timeoutMs)
        : undefined;

    const onUserAbort = (): void => controller.abort();
    if (userSignal) {
      if (userSignal.aborted) controller.abort();
      else userSignal.addEventListener("abort", onUserAbort, { once: true });
    }

    try {
      return await this.options.fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    } catch (cause) {
      const message = timedOut
        ? `Request timed out after ${this.options.timeoutMs}ms`
        : userSignal?.aborted
          ? "Request aborted"
          : `Network error: ${
              cause instanceof Error ? cause.message : String(cause)
            }`;
      throw new SuzukiNetworkError(message, { cause, url, timedOut });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      userSignal?.removeEventListener("abort", onUserAbort);
    }
  }
}

/** Read a response body once, keeping both the text and any parsed JSON. */
async function drain(response: Response): Promise<RawResponse> {
  const text = await response.text();
  let json: unknown;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    text,
    json,
  };
}
