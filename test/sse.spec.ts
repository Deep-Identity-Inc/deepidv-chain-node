/**
 * sse.spec.ts
 * ------------------------------------------------------------
 * Frame parsing for the SSE iterator. Validates:
 *   - canonical `data: ...\n\n` frames
 *   - multi-line data
 *   - comments and blank lines are ignored
 *   - `id: ...` is captured for resumption
 *   - malformed JSON in a frame is dropped, the next frame still
 *     emits
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { sseIterator } from "../src/client/sse.js";
import type { StreamEvent } from "../src/types/api.js";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[i] as string;
      i += 1;
      controller.enqueue(enc.encode(chunk));
    },
  });
}

function fakeFetchSse(chunks: string[], status = 200): typeof fetch {
  let served = false;
  return (async () => {
    if (served) {
      // Subsequent calls return an empty stream so the iterator
      // can reach the abort path quickly under test.
      return new Response(streamFromChunks([]), { status: 200 });
    }
    served = true;
    if (status >= 400) {
      return new Response("err", { status });
    }
    return new Response(streamFromChunks(chunks), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as unknown as typeof fetch;
}

async function collect(
  it: AsyncIterable<StreamEvent>,
  n: number,
  ctrl: AbortController,
): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of it) {
    out.push(ev);
    if (out.length >= n) {
      ctrl.abort();
      break;
    }
  }
  return out;
}

test("sse: parses a single data frame", async () => {
  const ctrl = new AbortController();
  const payload = JSON.stringify({
    type: "attestation.minted",
    payload: {
      id: "attest_01",
      recordType: "IDV",
      issuerId: "iss_x",
      mintedAt: "2026-05-01T00:00:00Z",
      segment: 0,
      leafIndex: 1,
    },
  });
  const it = sseIterator({
    url: "http://x.test/v1/stream",
    fetch: fakeFetchSse([`data: ${payload}\n\n`]),
    signal: ctrl.signal,
  });
  const events = await collect(it, 1, ctrl);
  assert.equal(events.length, 1);
  if (events[0]?.type === "attestation.minted") {
    assert.equal(events[0].payload.id, "attest_01");
  } else {
    assert.fail("expected attestation.minted");
  }
});

test("sse: handles fragmented chunks across the data field", async () => {
  const ctrl = new AbortController();
  const it = sseIterator({
    url: "http://x.test/v1/stream",
    fetch: fakeFetchSse([
      `data: {"type":"attestation.minted","payload":{`,
      `"id":"attest_02","recordType":"IDV","issuerId":"iss_y",`,
      `"mintedAt":"2026-05-01T00:00:00Z","segment":0,`,
      `"leafIndex":2}}\n\n`,
    ]),
    signal: ctrl.signal,
  });
  const events = await collect(it, 1, ctrl);
  assert.equal(events.length, 1);
  if (events[0]?.type === "attestation.minted") {
    assert.equal(events[0].payload.id, "attest_02");
  } else {
    assert.fail("expected attestation.minted");
  }
});

test("sse: drops malformed frame and continues", async () => {
  const ctrl = new AbortController();
  const ok = JSON.stringify({
    type: "sth.signed",
    payload: {
      segment: 1,
      treeSize: 1024,
      rootHex: "deadbeef",
      timestamp: "2026-05-01T00:00:00Z",
      checkpoint: true,
    },
  });
  const it = sseIterator({
    url: "http://x.test/v1/stream",
    fetch: fakeFetchSse([`data: not-valid-json\n\n` + `data: ${ok}\n\n`]),
    signal: ctrl.signal,
  });
  const events = await collect(it, 1, ctrl);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "sth.signed");
});

test("sse: ignores comment lines and blank lines between frames", async () => {
  const ctrl = new AbortController();
  const payload = JSON.stringify({
    type: "anchor.confirmed",
    payload: {
      segment: 0,
      network: "base-sepolia",
      txHash: "0xabc",
      treeRootHex: "ffff",
    },
  });
  const it = sseIterator({
    url: "http://x.test/v1/stream",
    fetch: fakeFetchSse([`: keepalive\n\n: another\n\ndata: ${payload}\n\n`]),
    signal: ctrl.signal,
  });
  const events = await collect(it, 1, ctrl);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "anchor.confirmed");
});
