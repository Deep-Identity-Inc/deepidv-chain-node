/**
 * client.spec.ts
 * ------------------------------------------------------------
 * Unit tests for the API client. We inject a fake `fetch` and assert
 * the right URLs are hit, the right errors are thrown for the right
 * status codes, and the right headers come back from `Retry-After`
 * parsing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { createClient } from "../src/client/index.js";
import {
  DeepidvApiError,
  DeepidvAuthError,
  DeepidvNotFoundError,
  DeepidvRateLimitError,
  DeepidvServerError,
} from "../src/errors/index.js";

function fakeFetch(map: Record<string, () => Response>): typeof fetch {
  const f: typeof fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const handler = map[url];
    if (!handler) {
      throw new Error(`fakeFetch: no handler for ${url}`);
    }
    return handler();
  };
  return f;
}

test("client: getAttestation hits /v1/attestation/:id", async () => {
  const client = createClient({
    apiUrl: "https://x.test",
    fetch: fakeFetch({
      "https://x.test/v1/attestation/attest_01": () =>
        new Response(JSON.stringify({ id: "attest_01" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    }),
  });
  const a = await client.getAttestation("attest_01");
  assert.equal(a.id, "attest_01");
});

test("client: listRegistry encodes filters into query string", async () => {
  let seenUrl = "";
  const client = createClient({
    apiUrl: "https://x.test",
    fetch: ((input: Parameters<typeof fetch>[0]) => {
      seenUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      return Promise.resolve(
        new Response(JSON.stringify({ items: [], nextCursor: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch,
  });
  await client.listRegistry({ type: "IDV", issuer: "iss_x", q: "abc" });
  assert.match(seenUrl, /\/v1\/registry\?/);
  assert.match(seenUrl, /type=IDV/);
  assert.match(seenUrl, /issuer=iss_x/);
  assert.match(seenUrl, /q=abc/);
});

test("client: 401 → DeepidvAuthError", async () => {
  const client = createClient({
    apiUrl: "https://x.test",
    fetch: fakeFetch({
      "https://x.test/v1/issuer/iss_x": () =>
        new Response("nope", {
          status: 401,
          headers: { "x-request-id": "req-123" },
        }),
    }),
  });
  await assert.rejects(
    () => client.getIssuer("iss_x"),
    (err: unknown) => {
      assert.ok(err instanceof DeepidvAuthError);
      assert.ok(err instanceof DeepidvApiError);
      assert.equal(err.status, 401);
      assert.equal(err.requestId, "req-123");
      return true;
    },
  );
});

test("client: 404 → DeepidvNotFoundError", async () => {
  const client = createClient({
    apiUrl: "https://x.test",
    fetch: fakeFetch({
      "https://x.test/v1/attestation/missing": () =>
        new Response("", { status: 404 }),
    }),
  });
  await assert.rejects(
    () => client.getAttestation("missing"),
    (err: unknown) => err instanceof DeepidvNotFoundError,
  );
});

test("client: 429 includes retryAfterSeconds", async () => {
  const client = createClient({
    apiUrl: "https://x.test",
    fetch: fakeFetch({
      "https://x.test/v1/log": () =>
        new Response("slow down", {
          status: 429,
          headers: { "retry-after": "12" },
        }),
    }),
  });
  await assert.rejects(
    () => client.getLog(),
    (err: unknown) => {
      assert.ok(err instanceof DeepidvRateLimitError);
      assert.equal(err.retryAfterSeconds, 12);
      return true;
    },
  );
});

test("client: 5xx → DeepidvServerError", async () => {
  const client = createClient({
    apiUrl: "https://x.test",
    fetch: fakeFetch({
      "https://x.test/v1/segment/0": () =>
        new Response("boom", { status: 503 }),
    }),
  });
  await assert.rejects(
    () => client.getSegment(0),
    (err: unknown) => err instanceof DeepidvServerError,
  );
});

test("client: downloadBundle returns ArrayBuffer", async () => {
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // ZIP magic
  const client = createClient({
    apiUrl: "https://x.test",
    fetch: fakeFetch({
      "https://x.test/v1/bundle/attest_xy": () =>
        new Response(bytes, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
    }),
  });
  const ab = await client.downloadBundle("attest_xy");
  assert.equal(ab.byteLength, 4);
  const view = new Uint8Array(ab);
  assert.deepEqual(Array.from(view), [0x50, 0x4b, 0x03, 0x04]);
});

test("client: getConsistencyProof builds the right URL", async () => {
  let seen = "";
  const client = createClient({
    apiUrl: "https://x.test",
    fetch: ((input: Parameters<typeof fetch>[0]) => {
      seen =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            segment: 0,
            fromTreeSize: 100,
            toTreeSize: 200,
            oldRootHex: "a",
            newRootHex: "b",
            proof: [],
          }),
          { status: 200 },
        ),
      );
    }) as typeof fetch,
  });
  await client.getConsistencyProof(100, 200, 0);
  assert.match(seen, /\/v1\/consistency\?/);
  assert.match(seen, /from=100/);
  assert.match(seen, /to=200/);
  assert.match(seen, /segment=0/);
});

test("client: trims trailing slash in apiUrl", () => {
  const client = createClient({ apiUrl: "https://x.test/" });
  assert.equal(client.apiUrl, "https://x.test");
});

test("client: invalid JSON throws DeepidvApiError", async () => {
  const client = createClient({
    apiUrl: "https://x.test",
    fetch: fakeFetch({
      "https://x.test/v1/log": () =>
        new Response("not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    }),
  });
  await assert.rejects(
    () => client.getLog(),
    (err: unknown) => err instanceof DeepidvApiError,
  );
});
