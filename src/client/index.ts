/**
 * `@deepidv/chain/client` — typed wrapper around the public registry
 * API at `api.proof.deepidv.com/v1`.
 *
 * The client is a thin GET-only fetcher: every operation is a read.
 * Mint and revoke are tenant-authenticated operations that don't
 * belong on this SDK in v1 — they live behind tenant-API-key auth on
 * a different surface (see runbook §0.E for credential hygiene).
 *
 * Pluggable `fetch` lets consumers wire in:
 *   - `node-fetch` polyfills (Node <20 — discouraged but supported)
 *   - request signing wrappers
 *   - Cloudflare Workers / Bun / Deno's native fetch
 *
 * SSE streaming is exposed as `streamAttestations()`, which returns
 * an `AsyncIterable<StreamEvent>` with built-in reconnect.
 *
 * Bundle download returns an `ArrayBuffer` ready to be unzipped by
 * the verify module.
 */

import {
  DeepidvApiError,
  DeepidvNetworkError,
  DeepidvRateLimitError,
  statusToErrorClass,
} from "../errors/index.js";
import type {
  AttestationDetail,
  ConsistencyProofResponse,
  IssuerDetail,
  RegistryListFilters,
  RegistryPage,
  SegmentDetail,
  StreamEvent,
  SthListResponse,
} from "../types/api.js";
import { sseIterator } from "./sse.js";

export type FetchLike = typeof fetch;

export interface ClientOptions {
  /**
   * Base URL of the registry API. Default:
   * `https://staging-api.proof.deepidv.com`.
   *
   * Production hosts the same surface at
   * `https://api.proof.deepidv.com`. Override at construction time.
   * No trailing slash; the client adds `/v1/...` paths.
   */
  apiUrl?: string;
  /**
   * Custom fetch implementation. Defaults to `globalThis.fetch`.
   * Pass a wrapped fetch to inject headers, telemetry, or retries.
   */
  fetch?: FetchLike;
  /**
   * Optional default `User-Agent`. The registry doesn't require one
   * but identifying SDK versions makes operator triage easier.
   */
  userAgent?: string;
  /**
   * Default per-request timeout in milliseconds. Default `15_000`.
   * `0` disables. Plumbed via `AbortSignal.timeout(...)`.
   */
  timeoutMs?: number;
}

const DEFAULT_API_URL = "https://staging-api.proof.deepidv.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const SDK_USER_AGENT = "deepidv-chain-node/1.1.0";

export interface RequestOptions {
  signal?: AbortSignal;
  /** Per-request override of the client's default timeout. */
  timeoutMs?: number;
}

export class DeepidvChainClient {
  public readonly apiUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly userAgent: string;
  private readonly defaultTimeoutMs: number;

  constructor(opts: ClientOptions = {}) {
    this.apiUrl = (opts.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
    this.fetchImpl =
      opts.fetch ??
      (typeof globalThis.fetch === "function"
        ? globalThis.fetch.bind(globalThis)
        : (() => {
            throw new DeepidvNetworkError(
              "no fetch available — pass a `fetch` option (Node 20+ has it built in)",
            );
          })());
    this.userAgent = opts.userAgent ?? SDK_USER_AGENT;
    this.defaultTimeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /* ------------------------------------------------------------ *
   *  Public read methods
   * ------------------------------------------------------------ */

  async getAttestation(
    id: string,
    opts: RequestOptions = {},
  ): Promise<AttestationDetail> {
    return this.requestJson<AttestationDetail>(
      `/v1/attestation/${encodeURIComponent(id)}`,
      opts,
    );
  }

  async listRegistry(
    filters: RegistryListFilters & { page?: number; cursor?: string } = {},
    opts: RequestOptions = {},
  ): Promise<RegistryPage> {
    const search = new URLSearchParams();
    if (typeof filters.page === "number") {
      search.set("page", String(filters.page));
    }
    if (filters.cursor) search.set("cursor", filters.cursor);
    if (filters.type) search.set("type", filters.type);
    if (filters.issuer) search.set("issuer", filters.issuer);
    if (filters.q) search.set("q", filters.q);
    const qs = search.toString();
    return this.requestJson<RegistryPage>(
      `/v1/registry${qs ? `?${qs}` : ""}`,
      opts,
    );
  }

  async getIssuer(
    id: string,
    opts: RequestOptions = {},
  ): Promise<IssuerDetail> {
    return this.requestJson<IssuerDetail>(
      `/v1/issuer/${encodeURIComponent(id)}`,
      opts,
    );
  }

  async getSegment(
    n: number,
    opts: RequestOptions = {},
  ): Promise<SegmentDetail> {
    return this.requestJson<SegmentDetail>(`/v1/segment/${n}`, opts);
  }

  async listSths(
    segment: number,
    opts: RequestOptions = {},
  ): Promise<SthListResponse> {
    return this.requestJson<SthListResponse>(
      `/v1/sth?segment=${segment}`,
      opts,
    );
  }

  async getConsistencyProof(
    fromTreeSize: number,
    toTreeSize: number,
    segment: number,
    opts: RequestOptions = {},
  ): Promise<ConsistencyProofResponse> {
    const search = new URLSearchParams({
      from: String(fromTreeSize),
      to: String(toTreeSize),
      segment: String(segment),
    });
    return this.requestJson<ConsistencyProofResponse>(
      `/v1/consistency?${search.toString()}`,
      opts,
    );
  }

  /**
   * The transparency log viewer endpoint — returns the latest
   * checkpoint for every open segment plus the current head's STH.
   * Shape is the same as `getSegment` for each entry.
   */
  async getLog(
    opts: RequestOptions = {},
  ): Promise<{ segments: SegmentDetail[] }> {
    return this.requestJson<{ segments: SegmentDetail[] }>(`/v1/log`, opts);
  }

  /**
   * Download a `.dpiv-bundle` zip as raw bytes. The caller unzips
   * and feeds the result to `verifyBundle()` from
   * `@deepidv/chain/verify`.
   */
  async downloadBundle(
    id: string,
    opts: RequestOptions = {},
  ): Promise<ArrayBuffer> {
    const path = `/v1/bundle/${encodeURIComponent(id)}`;
    const res = await this.rawRequest(path, {
      ...opts,
      headers: { Accept: "application/octet-stream" },
    });
    return await res.arrayBuffer();
  }

  /**
   * Subscribe to live attestation events.
   *
   * Returns an `AsyncIterable<StreamEvent>`. The iterator manages
   * reconnection internally (exponential backoff, jittered, capped
   * at 30s). Pass `signal` to stop iterating cleanly.
   *
   *     const ctrl = new AbortController();
   *     for await (const ev of client.streamAttestations({ signal: ctrl.signal })) {
   *       if (ev.type === "attestation.minted") {
   *         console.log(ev.payload.id);
   *       }
   *     }
   */
  streamAttestations(
    opts: { signal?: AbortSignal | undefined } = {},
  ): AsyncIterable<StreamEvent> {
    const url = `${this.apiUrl}/v1/stream`;
    return sseIterator({
      url,
      fetch: this.fetchImpl,
      signal: opts.signal,
      headers: { "User-Agent": this.userAgent },
    });
  }

  /* ------------------------------------------------------------ *
   *  Internal request plumbing
   * ------------------------------------------------------------ */

  private async requestJson<T>(path: string, opts: RequestOptions): Promise<T> {
    const res = await this.rawRequest(path, {
      ...opts,
      headers: { Accept: "application/json" },
    });
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new DeepidvApiError("invalid JSON in response", {
        path,
        status: res.status,
        cause: err,
      });
    }
  }

  private async rawRequest(
    path: string,
    opts: RequestOptions & { headers?: Record<string, string> },
  ): Promise<Response> {
    const url = `${this.apiUrl}${path}`;
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;

    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      ...(opts.headers ?? {}),
    };

    const signal = combineSignals(opts.signal, timeoutMs);

    let res: Response;
    try {
      const init: RequestInit = { method: "GET", headers };
      if (signal) init.signal = signal;
      res = await this.fetchImpl(url, init);
    } catch (err) {
      throw new DeepidvNetworkError(
        `network error fetching ${path}: ${describeError(err)}`,
        { path, cause: err },
      );
    }

    if (!res.ok) {
      const requestId =
        res.headers.get("x-request-id") ??
        res.headers.get("x-amzn-requestid") ??
        undefined;
      const body = await res.text().catch(() => "");
      const ErrorClass = statusToErrorClass(res.status);
      const ctx: { path: string; status: number; requestId?: string } = {
        path,
        status: res.status,
      };
      if (requestId !== undefined) ctx.requestId = requestId;
      if (ErrorClass === DeepidvRateLimitError) {
        const retryAfter = res.headers.get("retry-after");
        const retryAfterSeconds = retryAfter
          ? Number.parseInt(retryAfter, 10)
          : undefined;
        const rlCtx: typeof ctx & { retryAfterSeconds?: number } = ctx;
        if (
          retryAfterSeconds !== undefined &&
          Number.isFinite(retryAfterSeconds)
        ) {
          rlCtx.retryAfterSeconds = retryAfterSeconds;
        }
        throw new DeepidvRateLimitError(
          truncateBody(body) || "rate limited",
          rlCtx,
        );
      }
      throw new ErrorClass(truncateBody(body) || `HTTP ${res.status}`, ctx);
    }
    return res;
  }
}

/**
 * Convenience constructor — many consumers prefer
 * `createClient({...})` over `new DeepidvChainClient({...})`.
 */
export function createClient(opts: ClientOptions = {}): DeepidvChainClient {
  return new DeepidvChainClient(opts);
}

function combineSignals(
  caller: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal | undefined {
  if (timeoutMs <= 0) return caller;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!caller) return timeoutSignal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([caller, timeoutSignal]);
  }
  // Fallback for runtimes without AbortSignal.any.
  const ctrl = new AbortController();
  const onAbort = (sig: AbortSignal): void => {
    ctrl.abort(sig.reason);
  };
  caller.addEventListener("abort", () => onAbort(caller), { once: true });
  timeoutSignal.addEventListener("abort", () => onAbort(timeoutSignal), {
    once: true,
  });
  return ctrl.signal;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function truncateBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length <= 200) return trimmed;
  return trimmed.slice(0, 200) + "…";
}
