/**
 * JCS unit tests.
 *
 * Cover the four shapes that show up in EnvelopeV1 and STH —
 * primitives, arrays, nested objects, and key-order independence —
 * before any cross-language parity check kicks in.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { jcs } from "../src/crypto/jcs.js";

test("jcs: primitives", () => {
  assert.equal(jcs(null), "null");
  assert.equal(jcs(true), "true");
  assert.equal(jcs(false), "false");
  assert.equal(jcs(0), "0");
  assert.equal(jcs(42), "42");
  assert.equal(jcs(-1), "-1");
  assert.equal(jcs("hello"), '"hello"');
  assert.equal(jcs(""), '""');
});

test("jcs: empty containers", () => {
  assert.equal(jcs([]), "[]");
  assert.equal(jcs({}), "{}");
});

test("jcs: arrays preserve order, are not sorted", () => {
  assert.equal(jcs([3, 1, 2]), "[3,1,2]");
  assert.equal(jcs(["c", "a", "b"]), '["c","a","b"]');
});

test("jcs: object keys are sorted lexically", () => {
  const sorted = jcs({ a: 1, b: 2, c: 3 });
  const unsorted = jcs({ c: 3, b: 2, a: 1 });
  assert.equal(sorted, unsorted);
  assert.equal(sorted, '{"a":1,"b":2,"c":3}');
});

test("jcs: nested objects sort at every depth", () => {
  const out = jcs({ outer: { z: 1, a: 2 }, b: 3 });
  assert.equal(out, '{"b":3,"outer":{"a":2,"z":1}}');
});

test("jcs: rejects non-finite numbers", () => {
  assert.throws(() => jcs(Number.NaN), /non-finite number/);
  assert.throws(() => jcs(Number.POSITIVE_INFINITY), /non-finite/);
  assert.throws(() => jcs(Number.NEGATIVE_INFINITY), /non-finite/);
});

test("jcs: rejects unsupported types", () => {
  assert.throws(() => jcs(undefined), /unsupported type/);
  assert.throws(() => jcs(() => 1), /unsupported type/);
  assert.throws(() => jcs(BigInt(1)), /unsupported type/);
});

test("jcs: SHA-256 of canonical bytes is determinism-stable", () => {
  // Belt-and-suspenders: hashing twice with shuffled keys must
  // collapse to the same digest. This is what envelope_hash and
  // sth_hash rely on for cross-language parity.
  const a = { v: 1, t: "IDV", id: "x", subject: "y" };
  const b = { id: "x", t: "IDV", v: 1, subject: "y" };
  const ha = createHash("sha256").update(jcs(a)).digest("hex");
  const hb = createHash("sha256").update(jcs(b)).digest("hex");
  assert.equal(ha, hb);
});
