/**
 * Unified error hierarchy shared by every client in this package.
 *
 * Every error thrown by this SDK extends {@link SuzukiError}, so a single
 * `catch (err) { if (err instanceof SuzukiError) ... }` is enough to trap
 * anything the package throws.
 *
 * ```
 * SuzukiError
 * ├── SuzukiApiError          server answered, but reported failure
 * │   └── SuzukiSessionExpiredError   401/403 (e-Parts) or envelope 498 (MySuzuki)
 * └── SuzukiNetworkError      fetch failed / timed out / aborted; no usable response
 * ```
 */

/** Base class for every error thrown by this package. */
export class SuzukiError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface ApiErrorDetails {
  /** Request URL that produced the failure, when known. */
  url?: string;
  /** Real HTTP status of the response. */
  httpStatus: number;
  /**
   * Application-level status from the response body.
   *
   * - e-Parts: the optional `code` field (`0`/`200` mean success).
   * - MySuzuki: the envelope `code` field, which is authoritative because
   *   MySuzuki always answers HTTP 200.
   */
  code?: number | string;
  /** `request_id` from the e-Parts envelope, when present. */
  requestId?: string;
  /** Parsed body, or the raw text when the body was not JSON. */
  body?: unknown;
}

/** The server responded, but the response indicated a failure. */
export class SuzukiApiError extends SuzukiError {
  readonly url: string | undefined;
  readonly httpStatus: number;
  readonly code: number | string | undefined;
  readonly requestId: string | undefined;
  readonly body: unknown;

  constructor(message: string, details: ApiErrorDetails) {
    super(message);
    this.url = details.url;
    this.httpStatus = details.httpStatus;
    this.code = details.code;
    this.requestId = details.requestId;
    this.body = details.body;
  }
}

/**
 * The endpoint requires a session that is missing, invalid or expired.
 *
 * Raised on HTTP 401/403 or e-Parts body code 401/403, and on MySuzuki
 * envelope code 498.
 */
export class SuzukiSessionExpiredError extends SuzukiApiError {}

export interface NetworkErrorOptions {
  cause?: unknown;
  url?: string;
  /** True when the failure was the per-request timeout, not the caller's signal. */
  timedOut?: boolean;
}

/** `fetch` failed, timed out, or was aborted. No usable HTTP response. */
export class SuzukiNetworkError extends SuzukiError {
  readonly url: string | undefined;
  readonly timedOut: boolean;

  constructor(message: string, options?: NetworkErrorOptions) {
    super(message, options);
    this.url = options?.url;
    this.timedOut = options?.timedOut ?? false;
  }
}
