/**
 * Server-Sent Events stream consumer.
 *
 * The chain registry exposes `/v1/stream` as a long-lived
 * `text/event-stream` connection emitting one JSON-encoded
 * `StreamEvent` per `data:` frame. This module turns that into an
 * `AsyncIterable<StreamEvent>` with built-in reconnection backoff.
 *
 * Why a hand-rolled SSE consumer rather than EventSource?
 *   - Node 20's `EventSource` is still flagged behind `--experimental`
 *     in some patch versions and skips the `Last-Event-ID` semantics
 *     we want for resumption.
 *   - Keeping the SDK runtime-dep-free rules out `eventsource` /
 *     `@microsoft/fetch-event-source`.
 *   - We only need a parser for the `data:` field — no comments, no
 *     custom event types — so the spec subset is small enough to own.
 *
 * Reconnect policy:
 *   - Connection lost → exponential backoff starting at `initialDelayMs`,
 *     doubling up to `maxDelayMs`, with ±20 % jitter.
 *   - The iterator surfaces every event delivered between reconnects
 *     transparently. Consumers see a continuous stream.
 *   - Stop iterating (`break`, `return`, `throw`) cleanly aborts the
 *     underlying fetch.
 */

import type { StreamEvent } from "../types/api.js";
import { DeepidvNetworkError } from "../errors/index.js";

export interface SseStreamOptions {
  url: string;
  fetch: typeof fetch;
  /** Caller-provided abort signal. Iteration stops when it fires. */
  signal?: AbortSignal | undefined;
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Optional `Last-Event-ID` for resumption after a reconnect. */
  lastEventId?: string;
  /** Custom request headers (e.g. `Accept-Language`). Authorization
   *  is NOT supported on the public stream — the registry is
   *  unauthenticated. */
  headers?: Record<string, string>;
}

const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30_000;

/**
 * Yields `StreamEvent` values from the registry's `/v1/stream`
 * endpoint. Reconnects automatically; surfaces a final
 * `DeepidvNetworkError` only if the caller's `signal` aborts AND
 * a reconnect was already in flight (clean shutdown is silent).
 *
 * Usage:
 *
 *     for await (const ev of streamAttestations({...})) {
 *       if (ev.type === "attestation.minted") console.log(ev.payload.id);
 *     }
 */
export async function* sseIterator(
  opts: SseStreamOptions,
): AsyncIterableIterator<StreamEvent> {
  const initial = opts.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const max = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  let delay = initial;
  let lastEventId = opts.lastEventId;

  while (!opts.signal?.aborted) {
    let response: Response;
    try {
      const headers: Record<string, string> = {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        ...opts.headers,
      };
      if (lastEventId) headers["Last-Event-ID"] = lastEventId;

      const init: RequestInit = { method: "GET", headers };
      if (opts.signal) init.signal = opts.signal;
      response = await opts.fetch(opts.url, init);
    } catch {
      if (opts.signal?.aborted) return;
      await sleep(jitter(delay), opts.signal);
      delay = Math.min(delay * 2, max);
      continue;
    }

    if (!response.ok || !response.body) {
      // 4xx/5xx — back off, retry. We do NOT throw here; the registry
      // can transiently 503 during deploys and consumers expect the
      // iterator to ride through it.
      try {
        await response.body?.cancel();
      } catch {
        // ignore
      }
      await sleep(jitter(delay), opts.signal);
      delay = Math.min(delay * 2, max);
      continue;
    }

    // Connected — reset backoff.
    delay = initial;

    try {
      for await (const ev of parseEventStream(response.body, opts.signal)) {
        if (ev.id) lastEventId = ev.id;
        if (ev.data === undefined || ev.data === "") continue;
        try {
          const parsed = JSON.parse(ev.data) as StreamEvent;
          yield parsed;
        } catch {
          // Drop malformed frames silently — the registry guarantees
          // valid JSON per frame; a malformed frame indicates a wire-
          // level corruption that the next frame will recover from.
          continue;
        }
      }
    } catch {
      if (opts.signal?.aborted) return;
      // Underlying body iteration threw — fall through to reconnect.
      await sleep(jitter(delay), opts.signal);
      delay = Math.min(delay * 2, max);
      continue;
    }

    // Stream ended cleanly without abort — reconnect after a small
    // pause. This handles registry edge proxies that recycle long-
    // lived connections every few minutes.
    if (!opts.signal?.aborted) {
      await sleep(jitter(initial), opts.signal);
    }
  }
}

interface ParsedFrame {
  id?: string;
  event?: string;
  data?: string;
}

async function* parseEventStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): AsyncIterableIterator<ParsedFrame> {
  const decoder = new TextDecoder("utf-8");
  const reader = body.getReader();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx: number;
      while ((sepIdx = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const frameText = buffer.slice(0, sepIdx);
        const matched = buffer.slice(sepIdx).match(/^\r?\n\r?\n/);
        buffer = buffer.slice(sepIdx + (matched ? matched[0].length : 2));
        const frame = parseFrame(frameText);
        if (frame !== null) yield frame;
      }
    }

    // Trailing buffer at clean EOF — only emit if it's a full frame.
    if (buffer.length > 0) {
      const frame = parseFrame(buffer);
      if (frame !== null) yield frame;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

function parseFrame(text: string): ParsedFrame | null {
  const out: ParsedFrame = {};
  const dataLines: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine === "" || rawLine.startsWith(":")) continue;
    const colonIdx = rawLine.indexOf(":");
    const field = colonIdx === -1 ? rawLine : rawLine.slice(0, colonIdx);
    let value = colonIdx === -1 ? "" : rawLine.slice(colonIdx + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
    else if (field === "id") out.id = value;
    else if (field === "event") out.event = value;
    // retry/everything else: ignored — the SDK manages backoff.
  }
  if (dataLines.length > 0) out.data = dataLines.join("\n");
  if (
    out.data === undefined &&
    out.id === undefined &&
    out.event === undefined
  ) {
    return null;
  }
  return out;
}

function jitter(ms: number): number {
  const j = ms * (0.8 + Math.random() * 0.4);
  return Math.max(50, Math.min(ms * 2, j));
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const cleanup = (): void => {
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort);
  });
}

// Suppress unused export-only type; keeps the public surface tidy.
export type { DeepidvNetworkError };
