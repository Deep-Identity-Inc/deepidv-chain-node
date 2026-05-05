/**
 * manifest.spec.ts
 * ------------------------------------------------------------
 * Locks down the sha256sum-compatible MANIFEST.txt format against
 * the parity fixture used by shared-deps and chain-sdk-python.
 *
 * Locked SHA-256 of the canonical text:
 *   "fe6352dc308709902830020ce9e0fe28fa025365bab677326d19b75911852fbd"
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

import {
  serializeManifest,
  parseManifest,
  isValidSha256Hex,
} from "../src/crypto/manifest.js";
import type { ManifestEntry } from "../src/types/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "parity-manifest.json"), "utf8"),
) as { entries: ManifestEntry[]; expected_text_sha256: string };

test("manifest parity: serialize matches the locked SHA-256", () => {
  const text = serializeManifest(FIXTURE.entries);
  const digest = createHash("sha256").update(text).digest("hex");
  assert.equal(digest, FIXTURE.expected_text_sha256);
});

test("manifest: format is `<64 hex>  <path><LF>`", () => {
  const text = serializeManifest([
    { path: "envelope.json", sha256: "a".repeat(64) },
  ]);
  assert.equal(text, "a".repeat(64) + "  envelope.json\n");
});

test("manifest: input order does not affect output (sorted by path)", () => {
  const a = serializeManifest([
    { path: "z.txt", sha256: "0".repeat(64) },
    { path: "a.txt", sha256: "1".repeat(64) },
  ]);
  const b = serializeManifest([
    { path: "a.txt", sha256: "1".repeat(64) },
    { path: "z.txt", sha256: "0".repeat(64) },
  ]);
  assert.equal(a, b);
});

test("manifest: round-trip parse(serialize(x)) === x (sorted)", () => {
  const sorted = [...FIXTURE.entries].sort((x, y) =>
    x.path < y.path ? -1 : x.path > y.path ? 1 : 0,
  );
  const text = serializeManifest(FIXTURE.entries);
  const parsed = parseManifest(text);
  assert.deepEqual(parsed, sorted);
});

test("manifest: serialize rejects invalid sha256", () => {
  assert.throws(
    () => serializeManifest([{ path: "x", sha256: "ABCD" }]),
    /invalid sha256/,
  );
  assert.throws(
    () =>
      serializeManifest([
        { path: "x", sha256: "ABCD" + "0".repeat(60) }, // uppercase
      ]),
    /invalid sha256/,
  );
});

test("manifest: serialize rejects path with newline", () => {
  assert.throws(
    () => serializeManifest([{ path: "a\nb", sha256: "0".repeat(64) }]),
    /newline/,
  );
});

test("manifest: parse rejects duplicate paths", () => {
  const text = "0".repeat(64) + "  a.txt\n" + "1".repeat(64) + "  a.txt\n";
  assert.throws(() => parseManifest(text), /duplicate/);
});

test("manifest: parse rejects path that begins with whitespace", () => {
  const text = "0".repeat(64) + "   a.txt\n"; // three spaces — third leaks into path
  assert.throws(() => parseManifest(text), /whitespace/);
});

test("manifest: parse tolerates trailing CRLF", () => {
  const text = "0".repeat(64) + "  a.txt\r\n";
  const parsed = parseManifest(text);
  assert.deepEqual(parsed, [{ path: "a.txt", sha256: "0".repeat(64) }]);
});

test("manifest: isValidSha256Hex strict", () => {
  assert.equal(isValidSha256Hex("a".repeat(64)), true);
  assert.equal(isValidSha256Hex("A".repeat(64)), false); // uppercase
  assert.equal(isValidSha256Hex("a".repeat(63)), false); // short
  assert.equal(isValidSha256Hex("a".repeat(65)), false); // long
  assert.equal(isValidSha256Hex("g".repeat(64)), false); // non-hex
});
