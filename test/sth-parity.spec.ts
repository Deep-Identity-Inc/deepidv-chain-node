/**
 * sth-parity.spec.ts
 * ------------------------------------------------------------
 * Cross-language STH-hash parity. Same fixture as shared-deps and
 * chain-sdk-python; same locked SHA-256.
 *
 * EXPECTED_STH_HASH = "2c1e1d7e3898f93c355cd25866bb37f598ee19cce1b05eda049ccdbf51f2a7e7"
 * EXPECTED_JCS preimage is documented inline so any drift is visible
 * in a diff.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

import { sthHash } from "../src/crypto/hash.js";
import { jcs } from "../src/crypto/jcs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURE_PATH = join(__dirname, "fixtures", "parity-sth.json");
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<
  string,
  unknown
>;

const EXPECTED_STH_HASH =
  "2c1e1d7e3898f93c355cd25866bb37f598ee19cce1b05eda049ccdbf51f2a7e7";

const EXPECTED_JCS =
  `{"alg":"ECDSA_P256_SHA256","checkpoint":true,` +
  `"key_id":"arn:aws:kms:us-east-1:111122223333:key/` +
  `11111111-2222-3333-4444-555555555555","root":"` +
  `3333333333333333333333333333333333333333333333333333333333333333",` +
  `"segment":0,"timestamp":"2026-04-22T00:00:00Z","tree_size":1024,"v":1}`;

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

test("parity: sthHash matches the shared-deps locked SHA-256", () => {
  const actual = sthHash(FIXTURE);
  assert.equal(actual, EXPECTED_STH_HASH);
});

test("parity: jcs(sth) wire bytes match the locked preimage string", () => {
  assert.equal(jcs(FIXTURE), EXPECTED_JCS);
});

test("parity: jcs() output matches sortedStringify reference", () => {
  assert.equal(jcs(FIXTURE), sortedStringify(FIXTURE));
});

test("parity: SHA-256(jcs) equals SHA-256(sortedStringify)", () => {
  const j = createHash("sha256").update(jcs(FIXTURE)).digest("hex");
  const r = createHash("sha256")
    .update(sortedStringify(FIXTURE))
    .digest("hex");
  assert.equal(j, r);
});

test("parity: key-order shuffle yields the same STH hash", () => {
  const shuffled: Record<string, unknown> = {};
  for (const k of Object.keys(FIXTURE).sort().reverse()) {
    shuffled[k] = FIXTURE[k];
  }
  assert.equal(sthHash(shuffled), sthHash(FIXTURE));
});

test("sthHash strips master_sig before hashing", () => {
  const signed = { ...FIXTURE, master_sig: "b64:placeholder_signature_bytes" };
  assert.equal(sthHash(signed), sthHash(FIXTURE));
});

test("sthHash also strips legacy `sig` field", () => {
  const withLegacy = { ...FIXTURE, sig: "b64:legacy_placeholder" };
  assert.equal(sthHash(withLegacy), sthHash(FIXTURE));
});
