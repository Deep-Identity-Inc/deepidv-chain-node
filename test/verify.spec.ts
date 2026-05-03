/**
 * verify.spec.ts
 * ------------------------------------------------------------
 * End-to-end coverage for verifyBundle:
 *   - happy path produces ok=true and tsa_tokens="skipped"
 *   - tampered envelope.hash → fails at envelope_hash
 *   - tampered signature → fails at issuer_signature
 *   - tampered audit path → fails at merkle_inclusion
 *   - missing master_sig → fails at master_sth_signature
 *   - mismatched onchain.json → fails at onchain_anchor
 *   - missing onchain.json → onchain_anchor === "absent"
 *   - happy path through the zip path: build zip → verifyBundle(ab)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildBundle } from "./_fixtures/build-bundle.js";
import { buildStoredZip } from "./_fixtures/zip-builder.js";
import { verifyBundle, unzipBundle } from "../src/verify/index.js";
import { BUNDLE_FILES } from "../src/types/bundle.js";

test("verify: happy path → ok=true and tsa_tokens skipped", async () => {
  const { files } = buildBundle();
  const result = await verifyBundle(files);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.checks.envelope_hash, true);
  assert.equal(result.checks.issuer_signature, true);
  assert.equal(result.checks.tsa_tokens, "skipped");
  assert.equal(result.checks.merkle_inclusion, true);
  assert.equal(result.checks.master_sth_signature, true);
  assert.equal(result.checks.onchain_anchor, "absent");
  assert.deepEqual(result.skipped, ["tsa_tokens"]);
});

test("verify: with onchain.json → onchain_anchor=true and onchainReference exposed", async () => {
  const { files } = buildBundle({ withOnchain: true });
  const result = await verifyBundle(files);
  assert.equal(result.ok, true);
  assert.equal(result.checks.onchain_anchor, true);
  assert.ok(result.onchainReference);
  assert.equal(result.onchainReference?.chain, "base-sepolia");
});

test("verify: tampered envelope.hash → fails at envelope_hash", async () => {
  const { files } = buildBundle();
  files[BUNDLE_FILES.ENVELOPE_HASH] = new TextEncoder().encode(
    "0".repeat(64) + "\n",
  );
  const result = await verifyBundle(files);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /envelope_hash/);
});

test("verify: tampered signature.bin → fails at issuer_signature", async () => {
  const { files } = buildBundle();
  const sig = files[BUNDLE_FILES.SIGNATURE] as Uint8Array;
  // Flip a byte deep inside the signature so it remains DER-valid
  // length-wise but cryptographically invalid.
  const corrupted = new Uint8Array(sig);
  corrupted[corrupted.length - 1] =
    (corrupted[corrupted.length - 1] ?? 0) ^ 0xff;
  files[BUNDLE_FILES.SIGNATURE] = corrupted;
  const result = await verifyBundle(files);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /issuer_signature/);
});

test("verify: tampered audit_path → fails at merkle_inclusion", async () => {
  const { files } = buildBundle();
  // Inject a non-empty audit path; for a single-leaf tree the
  // inclusion walk must close to the leaf hash itself, so adding
  // even one sibling breaks it.
  const merkleText = new TextDecoder().decode(files[BUNDLE_FILES.MERKLE]);
  const merkle = JSON.parse(merkleText) as { audit_path: string[] };
  merkle.audit_path = ["a".repeat(64)];
  files[BUNDLE_FILES.MERKLE] = new TextEncoder().encode(JSON.stringify(merkle));
  const result = await verifyBundle(files);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /merkle_inclusion/);
});

test("verify: missing master_sig → fails at master_sth_signature", async () => {
  const { files } = buildBundle();
  const sthText = new TextDecoder().decode(files[BUNDLE_FILES.STH]);
  const sth = JSON.parse(sthText) as Record<string, unknown>;
  delete sth.master_sig;
  files[BUNDLE_FILES.STH] = new TextEncoder().encode(JSON.stringify(sth));
  const result = await verifyBundle(files);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /master_sth_signature/);
});

test("verify: onchain.json with mismatched root → fails at onchain_anchor", async () => {
  const { files } = buildBundle({ withOnchain: true });
  const onchainText = new TextDecoder().decode(files[BUNDLE_FILES.ONCHAIN]);
  const oc = JSON.parse(onchainText) as Record<string, unknown>;
  oc.root = "f".repeat(64);
  files[BUNDLE_FILES.ONCHAIN] = new TextEncoder().encode(JSON.stringify(oc));
  const result = await verifyBundle(files);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /onchain_anchor/);
});

test("verify: missing required file throws", async () => {
  const { files } = buildBundle();
  delete files[BUNDLE_FILES.ENVELOPE];
  await assert.rejects(() => verifyBundle(files), /missing required file/);
});

test("verify: round-trip through unzipBundle from a built zip", async () => {
  const { files } = buildBundle({ withOnchain: true });
  const zipped = buildStoredZip(files);
  const unzipped = unzipBundle(zipped);
  assert.ok(unzipped.files[BUNDLE_FILES.ENVELOPE]);
  const result = await verifyBundle(
    zipped.buffer.slice(
      zipped.byteOffset,
      zipped.byteOffset + zipped.byteLength,
    ) as ArrayBuffer,
  );
  assert.equal(result.ok, true);
});

test("unzip: rejects path with backslash", () => {
  const evil = buildStoredZip({ "evil\\path": new Uint8Array([1, 2, 3]) });
  assert.throws(() => unzipBundle(evil), /backslash/);
});

test("unzip: rejects parent-directory traversal", () => {
  const evil = buildStoredZip({ "../escape.txt": new Uint8Array([1, 2, 3]) });
  assert.throws(() => unzipBundle(evil), /parent-directory/);
});

test("unzip: rejects absolute path", () => {
  const evil = buildStoredZip({ "/etc/passwd": new Uint8Array([1, 2, 3]) });
  assert.throws(() => unzipBundle(evil), /absolute path/);
});

test("verify: result.skipped always contains tsa_tokens", async () => {
  const { files } = buildBundle();
  const result = await verifyBundle(files);
  assert.deepEqual(result.skipped, ["tsa_tokens"]);
});
