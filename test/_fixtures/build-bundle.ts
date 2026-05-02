/**
 * Test helper — build a fully-verifiable bundle in memory.
 *
 * Generates an ephemeral P-256 issuer keypair and chain-master
 * keypair, builds an envelope, signs it, computes a single-leaf
 * Merkle tree, signs the STH, and returns the file map ready to be
 * fed into `verifyBundle`.
 *
 * Used by the verify spec to exercise the cryptographic checks
 * end-to-end without dragging in a real KMS or a recorded fixture
 * that would lock down test bundles to a single envelope shape.
 */

import {
  generateKeyPairSync,
  createSign,
  type KeyObject,
} from "node:crypto";

import { jcs } from "../../src/crypto/jcs.js";
import { sha256Hex } from "../../src/crypto/hash.js";
import { leafHash } from "../../src/crypto/merkle.js";
import { serializeManifest } from "../../src/crypto/manifest.js";
import { BUNDLE_FILES } from "../../src/types/bundle.js";

export interface BuiltBundle {
  files: Record<string, Uint8Array>;
  /** Pre-computed envelope hash hex — handy for negative-case tests. */
  envelopeHashHex: string;
  /** Single-leaf STH root hex. */
  rootHex: string;
}

/**
 * Build a bundle whose `verifyBundle()` should return ok=true.
 *
 * Intentionally exposes the building blocks so tests can mutate one
 * field and assert the corresponding check fails.
 */
export function buildBundle(
  opts: {
    withOnchain?: boolean;
    mutate?: (files: Record<string, Uint8Array>) => void;
  } = {},
): BuiltBundle {
  // Issuer key + chain-master key.
  const issuer = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const master = generateKeyPairSync("ec", { namedCurve: "P-256" });

  const envelope = {
    v: 1,
    t: "IDV",
    id: "attest_01JTEST00000000000000001",
    tenant: "t_test",
    issuer: "iss_test",
    subject: "sha256:" + "1".repeat(64),
    claim_hash: "sha256:" + "2".repeat(64),
    rts: { digicert: "b64:placeholder" },
    minted_at: "2026-05-01T00:00:00Z",
    correlation_id: "evt_test_000001",
  };
  const envCanonical = jcs(envelope);
  const envelopeHashHex = sha256Hex(envCanonical);

  // Issuer signature over the JCS envelope bytes (KMS would produce
  // the same DER bytes from DIGEST mode; node:crypto's sign with
  // SHA256 is byte-equivalent for our verifier).
  const issuerSig = createSign("SHA256")
    .update(envCanonical)
    .end()
    .sign(issuer.privateKey);

  // Single-leaf Merkle tree → root == leaf hash.
  const leaf = leafHash(Buffer.from(envCanonical));
  const rootHex = leaf.toString("hex");

  const sth = {
    v: 1,
    alg: "ECDSA_P256_SHA256",
    segment: 0,
    tree_size: 1,
    root: rootHex,
    timestamp: "2026-05-01T00:00:01Z",
    key_id: "test-key",
    checkpoint: true,
  };
  const sthCanonical = jcs(sth);
  const masterSigDer = createSign("SHA256")
    .update(sthCanonical)
    .end()
    .sign(master.privateKey);
  const sthSigned = { ...sth, master_sig: masterSigDer.toString("base64") };

  const merkle = {
    v: 1,
    segment: 0,
    leaf_index: 0,
    leaf_hash: leaf.toString("hex"),
    audit_path: [],
  };

  const labels = { v: 1, labels: [] };

  const files: Record<string, Uint8Array> = {
    [BUNDLE_FILES.ENVELOPE]: utf8(envCanonical),
    [BUNDLE_FILES.ENVELOPE_HASH]: utf8(envelopeHashHex + "\n"),
    [BUNDLE_FILES.ISSUER_PEM]: utf8(toPem(issuer.publicKey)),
    [BUNDLE_FILES.MASTER_PEM]: utf8(toPem(master.publicKey)),
    [BUNDLE_FILES.SIGNATURE]: issuerSig,
    [BUNDLE_FILES.STH]: utf8(JSON.stringify(sthSigned)),
    [BUNDLE_FILES.MERKLE]: utf8(JSON.stringify(merkle)),
    [BUNDLE_FILES.LABELS]: utf8(JSON.stringify(labels)),
    [BUNDLE_FILES.VERIFY_SCRIPT]: utf8("#!/bin/sh\necho stub\n"),
    [BUNDLE_FILES.MERKLE_WALK_HELPER]: utf8("#!/bin/sh\necho stub\n"),
    [BUNDLE_FILES.TS_DIGICERT]: new Uint8Array([0x30, 0x82, 0x00, 0x00]),
    [BUNDLE_FILES.TS_DIGICERT_CA]: utf8("-----BEGIN CERTIFICATE-----\n"),
    [BUNDLE_FILES.TS_SECTIGO]: new Uint8Array([0x30, 0x82, 0x00, 0x00]),
    [BUNDLE_FILES.TS_SECTIGO_CA]: utf8("-----BEGIN CERTIFICATE-----\n"),
  };

  if (opts.withOnchain) {
    const onchain = {
      v: 1,
      chain: "base-sepolia",
      contract: "0x0000000000000000000000000000000000000001",
      tx: "0x" + "a".repeat(64),
      block: 12345,
      segment: 0,
      tree_size: 1,
      root: rootHex,
    };
    files[BUNDLE_FILES.ONCHAIN] = utf8(JSON.stringify(onchain));
  }

  // MANIFEST.txt last so its sha256 covers everything else.
  const manifestEntries = Object.entries(files).map(([path, bytes]) => ({
    path,
    sha256: sha256Hex(Buffer.from(bytes)),
  }));
  files[BUNDLE_FILES.MANIFEST] = utf8(serializeManifest(manifestEntries));

  if (opts.mutate) opts.mutate(files);

  return { files, envelopeHashHex, rootHex };
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function toPem(key: KeyObject): string {
  return key.export({ format: "pem", type: "spki" }) as string;
}
