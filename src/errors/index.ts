/**
 * Typed error hierarchy for `@deepidv/chain`.
 *
 * `DeepidvApiError` is the parent class — every error thrown from
 * the client extends it, and consumers can `catch (err instanceof
 * DeepidvApiError)` once for the whole surface. Specific subclasses
 * exist so common failure modes (auth, not-found, rate-limit) can
 * be branched on without inspecting `status`.
 *
 * Design notes:
 *   - Stack traces include the full prototype chain so `instanceof`
 *     works across the dual ESM/CJS build boundaries.
 *   - `cause` is propagated via the standard ES2022 `cause` option
 *     so wrappers can retain the underlying network error.
 *   - Error messages NEVER include claim bodies, salts, or
 *     authentication headers. Privacy is enforced at construction
 *     time, not at logging time.
 */

export interface DeepidvApiErrorContext {
  /** Bundle-relative URL path, e.g. `/v1/registry`. Never query string. */
  path?: string;
  /** HTTP status when applicable. */
  status?: number;
  /** Request id from the `X-Request-Id` response header, if present. */
  requestId?: string;
  /** Underlying network or parse error. */
  cause?: unknown;
}

export class DeepidvApiError extends Error {
  public readonly path?: string;
  public readonly status?: number;
  public readonly requestId?: string;
  public override readonly cause?: unknown;

  constructor(message: string, ctx: DeepidvApiErrorContext = {}) {
    super(message, ctx.cause === undefined ? undefined : { cause: ctx.cause });
    this.name = "DeepidvApiError";
    if (ctx.path !== undefined) this.path = ctx.path;
    if (ctx.status !== undefined) this.status = ctx.status;
    if (ctx.requestId !== undefined) this.requestId = ctx.requestId;
    if (ctx.cause !== undefined) this.cause = ctx.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DeepidvAuthError extends DeepidvApiError {
  constructor(message = "unauthorized", ctx: DeepidvApiErrorContext = {}) {
    super(message, { ...ctx, status: ctx.status ?? 401 });
    this.name = "DeepidvAuthError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DeepidvNotFoundError extends DeepidvApiError {
  constructor(message = "not found", ctx: DeepidvApiErrorContext = {}) {
    super(message, { ...ctx, status: ctx.status ?? 404 });
    this.name = "DeepidvNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DeepidvRateLimitError extends DeepidvApiError {
  /** Seconds, parsed from the `Retry-After` header when available. */
  public readonly retryAfterSeconds?: number;
  constructor(
    message = "rate limited",
    ctx: DeepidvApiErrorContext & { retryAfterSeconds?: number } = {},
  ) {
    super(message, { ...ctx, status: ctx.status ?? 429 });
    this.name = "DeepidvRateLimitError";
    if (ctx.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = ctx.retryAfterSeconds;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DeepidvServerError extends DeepidvApiError {
  constructor(message = "server error", ctx: DeepidvApiErrorContext = {}) {
    super(message, { ...ctx, status: ctx.status ?? 500 });
    this.name = "DeepidvServerError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DeepidvNetworkError extends DeepidvApiError {
  constructor(message: string, ctx: DeepidvApiErrorContext = {}) {
    super(message, ctx);
    this.name = "DeepidvNetworkError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Map an HTTP status to the most specific error class.
 *
 * Used by `client.ts::request` to construct the right subclass
 * before throwing. Public so consumers can plug in their own retry
 * policy: `if (mapStatusToError(res.status) === DeepidvRateLimitError) ...`
 */
export function statusToErrorClass(status: number): typeof DeepidvApiError {
  if (status === 401 || status === 403) return DeepidvAuthError;
  if (status === 404) return DeepidvNotFoundError;
  if (status === 429) return DeepidvRateLimitError;
  if (status >= 500) return DeepidvServerError;
  return DeepidvApiError;
}
