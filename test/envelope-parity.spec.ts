/**
 * envelope-parity.spec.ts
 * ------------------------------------------------------------
 * Locks down byte-identical output with shared-deps and the Python
 * SDK by hashing the SAME parity fixture and asserting the SAME
 * SHA-256.
 *
 *                      !! SHARED FIXTURE WARNING !!
 *
 * test/fixtures/parity-envelope.json is shared with:
 *   - shared-deps/src/chain/lib/__tests__/fixtures/parity-envelope.json
 *   - chain-sdk-python/tests/fixtures/parity-envelope.json (M08)
 *
 * EXPECTED_ENVELOPE_HASH below MUST equal the value asserted in
 * shared-deps' envelope-parity.spec.ts. Any change requires a
 * coordinated update across all three repos in the same PR cycle.
 *
 * Source-of-truth assertion (shared-deps as of v2.4.x):
 *   "03507fb35af9389513dc25baa9a8a7a609cfa240a300965187fec9426734ba26"
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

import { envelopeHash } from "../src/crypto/hash.js";
import { jcs } from "../src/crypto/jcs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURE_PATH = join(__dirname, "fixtures", "parity-envelope.json");
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<
  string,
  unknown
>;

const EXPECTED_ENVELOPE_HASH =
  "03507fb35af9389513dc25baa9a8a7a609cfa240a300965187fec9426734ba26";

/**
 * Independent reference canonicalization — proves jcs() matches a
 * "sort recursively + JSON.stringify primitives + no whitespace"
 * implementation. If these diverge, either jcs() has regressed or
 * the reference has, and we want to catch it before the SDK ships.
 */
function sortedStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(sortedStringify).join(",") + "]";
  }
  const sorted = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
  );
  return (
    "{" +
    sorted
      .map(([k, v]) => JSON.stringify(k) + ":" + sortedStringify(v))
      .join(",") +
    "}"
  );
}

test("parity: envelopeHash matches the shared-deps locked SHA-256", () => {
  const actual = envelopeHash(FIXTURE);
  assert.equal(
    actual,
    EXPECTED_ENVELOPE_HASH,
    "JCS canonicalization drift detected. If you changed jcs() or " +
      "the fixture intentionally, update EXPECTED_ENVELOPE_HASH here, " +
      "in shared-deps, and in chain-sdk-python in the same PR cycle.\n" +
      `Got: ${actual}\nExpected: ${EXPECTED_ENVELOPE_HASH}`,
  );
});

test("parity: jcs() output matches sortedStringify reference", () => {
  assert.equal(jcs(FIXTURE), sortedStringify(FIXTURE));
});

test("parity: SHA-256(jcs) equals SHA-256(sortedStringify)", () => {
  const j = createHash("sha256").update(jcs(FIXTURE)).digest("hex");
  const r = createHash("sha256").update(sortedStringify(FIXTURE)).digest("hex");
  assert.equal(j, r);
});

test("parity: key-order shuffle yields the same envelope hash", () => {
  const shuffled: Record<string, unknown> = {};
  const topKeys = Object.keys(FIXTURE).sort().reverse();
  for (const k of topKeys) shuffled[k] = FIXTURE[k];

  const rts = FIXTURE.rts as Record<string, unknown>;
  const rtsShuffled: Record<string, unknown> = {};
  for (const k of Object.keys(rts).sort().reverse()) {
    rtsShuffled[k] = rts[k];
  }
  shuffled.rts = rtsShuffled;

  const labels = FIXTURE.labels as Array<Record<string, unknown>>;
  shuffled.labels = labels.map((label) => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(label).sort().reverse()) {
      out[k] = label[k];
    }
    return out;
  });

  assert.equal(envelopeHash(shuffled), envelopeHash(FIXTURE));
});

test("envelopeHash strips defensive `sig` field", () => {
  const withSig = { ...FIXTURE, sig: "this should not appear in preimage" };
  assert.equal(envelopeHash(withSig), envelopeHash(FIXTURE));
});
