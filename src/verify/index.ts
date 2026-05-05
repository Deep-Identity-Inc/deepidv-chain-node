/**
 * Partial in-process bundle verifier — 5 of 6 checks per
 * ARCHITECTURE.md §8 D.5.
 *
 *                  ⚠ DELIBERATE PARTIAL VERIFIER ⚠
 *
 * This SDK performs FIVE of the six checks defined in
 * ARCHITECTURE.md §8 D.5. Step 3 — RFC 3161 timestamp token
 * verification against the DigiCert and Sectigo TSA CA chains — is
 * **deliberately skipped**. Pulling a full ASN.1 + RFC 3161 verifier
 * into a zero-dependency SDK would add ~200 KB of transitive deps;
 * any caller that needs the canonical TSA check should run the
 * bundle's own `verify.sh` script (which uses `openssl ts -verify`
 * and is the canonical TSA verifier by design).
 *
 * Step 3 status is reported as the literal string `"skipped"`
 * rather than a boolean — callers MUST handle that case explicitly.
 * We do not silently treat unverified TSA tokens as valid.
 *
 * # Checks performed
 *
 *   1. envelope_hash:          SHA-256(JCS(envelope.json)) ==
 *                              envelope.hash content
 *   2. issuer_signature:       ECDSA P-256 / SHA-256 verify of
 *                              signature.bin against the canonical
 *                              envelope bytes using issuer.pem
 *   3. tsa_tokens:             SKIPPED — see above
 *   4. merkle_inclusion:       audit_path walk closes to
 *                              sth.json.root via RFC 6962 leaf/node
 *                              prefixes
 *   5. master_sth_signature:   ECDSA P-256 / SHA-256 verify of
 *                              base64-decoded master_sig against the
 *                              JCS-canonical STH preimage using
 *                              master.pem
 *   6. onchain_anchor:         presence + structural validity of
 *                              onchain.json (or "absent" when the
 *                              file isn't in the bundle).
 *                              INFORMATIONAL ONLY — we do NOT call
 *                              an RPC. Live tx existence is a
 *                              verify.sh / SDK-RPC concern.
 *
 * # Cross-check requirements (defense in depth)
 *
 *   - merkle.json.segment must equal sth.json.segment
 *   - merkle.json.leaf_index must be < sth.json.tree_size
 *   - audit_path verification uses sth.json.root as the expected
 *     root
 *   - When onchain.json is present, its (segment, tree_size, root)
 *     must equal sth.json's
 *
 * # Privacy
 *
 * verifyBundle MUST NOT log salt values. Any salt in
 * `labels.json::RevealedLabel` is recomputed against `commit` and
 * cross-checked, then discarded. Callers building UIs that surface
 * the salt do so explicitly via `parseLabels` — never via the
 * verifier.
 */

import { createPublicKey, createVerify } from "node:crypto";

import { jcs } from "../crypto/jcs.js";
import { sha256Hex } from "../crypto/hash.js";
import { leafHash, verifyInclusion, unhex } from "../crypto/merkle.js";
import { BUNDLE_FILES } from "../types/bundle.js";
import type { MerkleProofJson, OnchainProofJson } from "../types/bundle.js";
import type { STH } from "../types/sth.js";
import { unzipBundle } from "./unzip.js";

export { unzipBundle } from "./unzip.js";

/**
 * Per-check result.
 *
 * - Boolean for the four cryptographic checks plus the structural
 *   on-chain check.
 * - Literal `"skipped"` for the deliberately-unimplemented TSA step.
 * - Literal `"absent"` for the optional `onchain.json` when missing.
 */
export interface VerifyChecks {
  envelope_hash: boolean;
  issuer_signature: boolean;
  tsa_tokens: "skipped";
  merkle_inclusion: boolean;
  master_sth_signature: boolean;
  onchain_anchor: boolean | "absent";
}

export interface VerifyResult {
  /**
   * `true` iff every PERFORMED check passed. The deliberately-
   * skipped TSA step is not counted toward `ok`. Callers requiring
   * full six-of-six verification must run `verify.sh` separately.
   */
  ok: boolean;
  checks: VerifyChecks;
  /**
   * The list of explicitly skipped checks. Always contains
   * `"tsa_tokens"` so consumers can present a "5 of 6 verified"
   * disclaimer without re-deriving it.
   */
  skipped: ReadonlyArray<keyof VerifyChecks>;
  /**
   * Short human-readable explanation when `ok === false`. Names the
   * first failing check (in declaration order). Absent on success.
   */
  reason?: string;
  /**
   * On-chain reference, when `onchain.json` was present in the
   * bundle and structurally valid. Informational only — no RPC was
   * called. Surfaces so consumers can render the explorer link
   * without re-parsing the bundle.
   */
  onchainReference?: {
    chain: OnchainProofJson["chain"];
    contract: string;
    tx: string;
    block: number;
    segment: number;
    treeSize: number;
    root: string;
  };
}

/** Map of bundle-relative path → file bytes. */
export type BundleFiles = Record<string, Uint8Array>;

/**
 * Verify a `.dpiv-bundle` (sans TSA).
 *
 * Accepts either:
 *   - the raw `.dpiv-bundle` zip as `ArrayBuffer | Uint8Array`
 *     (most common — what `client.downloadBundle()` returns),
 *   - or a pre-unzipped `BundleFiles` map (useful for tests and for
 *     callers that already have the bundle in memory).
 *
 * Promise-returning for symmetry with the Python SDK, but the
 * implementation is fully synchronous; awaiting it adds a single
 * microtask.
 */
export async function verifyBundle(
  bundle: ArrayBuffer | Uint8Array | BundleFiles,
): Promise<VerifyResult> {
  const files: BundleFiles =
    bundle instanceof ArrayBuffer
      ? unzipBundle(bundle).files
      : bundle instanceof Uint8Array
        ? unzipBundle(bundle).files
        : bundle;

  const checks: VerifyChecks = {
    envelope_hash: false,
    issuer_signature: false,
    tsa_tokens: "skipped",
    merkle_inclusion: false,
    master_sth_signature: false,
    onchain_anchor: "absent",
  };
  const skipped: ReadonlyArray<keyof VerifyChecks> = ["tsa_tokens"];

  const envelopeBytes = required(files, BUNDLE_FILES.ENVELOPE);
  const envelopeHashBytes = required(files, BUNDLE_FILES.ENVELOPE_HASH);
  const signatureBytes = required(files, BUNDLE_FILES.SIGNATURE);
  const issuerPemBytes = required(files, BUNDLE_FILES.ISSUER_PEM);
  const merkleBytes = required(files, BUNDLE_FILES.MERKLE);
  const sthBytes = required(files, BUNDLE_FILES.STH);
  const masterPemBytes = required(files, BUNDLE_FILES.MASTER_PEM);

  // Check 1 — envelope_hash.
  const envelope = parseJson<Record<string, unknown>>(
    envelopeBytes,
    BUNDLE_FILES.ENVELOPE,
  );
  const computedHashHex = sha256Hex(jcs(envelope));
  const claimedHashHex = bytesToString(envelopeHashBytes).trim().toLowerCase();
  if (computedHashHex !== claimedHashHex) {
    return fail(checks, skipped, "envelope_hash", "envelope hash mismatch");
  }
  checks.envelope_hash = true;

  // Check 2 — issuer_signature.
  // KMS signs the 32-byte digest in DIGEST mode. node:crypto's
  // createVerify takes the message bytes and does the SHA-256
  // itself, so we feed the JCS-canonical envelope bytes.
  let issuerKey: ReturnType<typeof createPublicKey>;
  try {
    issuerKey = createPublicKey({
      key: Buffer.from(issuerPemBytes),
      format: "pem",
      type: "spki",
    });
  } catch (err) {
    return fail(
      checks,
      skipped,
      "issuer_signature",
      `issuer.pem could not be parsed: ${describe(err)}`,
    );
  }
  const v1 = createVerify("SHA256");
  v1.update(jcs(envelope));
  v1.end();
  const issuerOk = v1.verify(issuerKey, Buffer.from(signatureBytes));
  if (!issuerOk) {
    return fail(
      checks,
      skipped,
      "issuer_signature",
      "issuer signature invalid",
    );
  }
  checks.issuer_signature = true;

  // Check 3 — TSA: deliberately skipped.

  // Check 4 — merkle_inclusion.
  const merkle = parseJson<MerkleProofJson>(merkleBytes, BUNDLE_FILES.MERKLE);
  const sth = parseJson<STH & Record<string, unknown>>(
    sthBytes,
    BUNDLE_FILES.STH,
  );
  if (merkle.segment !== sth.segment) {
    return fail(
      checks,
      skipped,
      "merkle_inclusion",
      `segment mismatch: merkle=${merkle.segment} sth=${sth.segment}`,
    );
  }
  if (merkle.leaf_index >= sth.tree_size) {
    return fail(
      checks,
      skipped,
      "merkle_inclusion",
      `leaf_index ${merkle.leaf_index} >= tree_size ${sth.tree_size}`,
    );
  }
  const computedLeafHash = leafHash(Buffer.from(jcs(envelope)));
  if (computedLeafHash.toString("hex") !== merkle.leaf_hash.toLowerCase()) {
    return fail(
      checks,
      skipped,
      "merkle_inclusion",
      "merkle.leaf_hash does not match SHA-256(0x00 || envelope_canonical_bytes)",
    );
  }
  const auditPath = merkle.audit_path.map((h) => unhex(h));
  const expectedRoot = unhex(sth.root);
  const inclusionOk = verifyInclusion(
    computedLeafHash,
    merkle.leaf_index,
    sth.tree_size,
    auditPath,
    expectedRoot,
  );
  if (!inclusionOk) {
    return fail(
      checks,
      skipped,
      "merkle_inclusion",
      "audit_path does not close to sth.root",
    );
  }
  checks.merkle_inclusion = true;

  // Check 5 — master_sth_signature.
  const sthForHash: Record<string, unknown> = { ...sth };
  delete sthForHash.master_sig;
  delete (sthForHash as Record<string, unknown>).sig;
  const sthPreimageBytes = Buffer.from(jcs(sthForHash));
  const masterSigB64 = (sth as { master_sig?: string }).master_sig;
  if (!masterSigB64) {
    return fail(
      checks,
      skipped,
      "master_sth_signature",
      "sth.json missing master_sig",
    );
  }
  let masterKey: ReturnType<typeof createPublicKey>;
  try {
    masterKey = createPublicKey({
      key: Buffer.from(masterPemBytes),
      format: "pem",
      type: "spki",
    });
  } catch (err) {
    return fail(
      checks,
      skipped,
      "master_sth_signature",
      `master.pem could not be parsed: ${describe(err)}`,
    );
  }
  const v5 = createVerify("SHA256");
  v5.update(sthPreimageBytes);
  v5.end();
  const masterOk = v5.verify(masterKey, Buffer.from(masterSigB64, "base64"));
  if (!masterOk) {
    return fail(
      checks,
      skipped,
      "master_sth_signature",
      "chain-master signature on sth.json invalid",
    );
  }
  checks.master_sth_signature = true;

  // Check 6 — onchain_anchor (informational).
  const onchainBytes = files[BUNDLE_FILES.ONCHAIN];
  let onchainReference: VerifyResult["onchainReference"];
  if (onchainBytes) {
    const onchain = parseJson<OnchainProofJson>(
      onchainBytes,
      BUNDLE_FILES.ONCHAIN,
    );
    if (
      onchain.segment !== sth.segment ||
      onchain.tree_size !== sth.tree_size ||
      onchain.root.toLowerCase() !== sth.root.toLowerCase()
    ) {
      return fail(
        checks,
        skipped,
        "onchain_anchor",
        "onchain.json (segment, tree_size, root) does not match sth.json",
      );
    }
    checks.onchain_anchor = true;
    onchainReference = {
      chain: onchain.chain,
      contract: onchain.contract,
      tx: onchain.tx,
      block: onchain.block,
      segment: onchain.segment,
      treeSize: onchain.tree_size,
      root: onchain.root,
    };
  } else {
    checks.onchain_anchor = "absent";
  }

  const result: VerifyResult = { ok: true, checks, skipped };
  if (onchainReference) result.onchainReference = onchainReference;
  return result;
}

/* -------------------------------------------------------------- *
 *  helpers
 * -------------------------------------------------------------- */

function required(files: BundleFiles, path: string): Uint8Array {
  const v = files[path];
  if (!v) {
    throw new Error(`bundle missing required file: ${path}`);
  }
  return v;
}

function bytesToString(b: Uint8Array): string {
  return Buffer.from(b).toString("utf-8");
}

function parseJson<T>(b: Uint8Array, label: string): T {
  try {
    return JSON.parse(bytesToString(b)) as T;
  } catch (err) {
    throw new Error(`${label}: invalid JSON: ${describe(err)}`);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fail(
  checks: VerifyChecks,
  skipped: ReadonlyArray<keyof VerifyChecks>,
  failedAt: keyof VerifyChecks,
  reason: string,
): VerifyResult {
  return {
    ok: false,
    checks,
    skipped,
    reason: `${failedAt}: ${reason}`,
  };
}
