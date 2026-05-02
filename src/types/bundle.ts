/**
 * `.dpiv-bundle` JSON shapes.
 *
 * Mirrors `shared-deps/chain/bundle/bundle-types.ts`. Any drift
 * between this file and ARCHITECTURE.md §8 is a bug — the
 * architecture doc wins.
 *
 * The files documented here are the JSON payloads inside a bundle:
 *   - `merkle.json`   — `MerkleProofJson`
 *   - `sth.json`      — `STH` (re-exported from `./sth`)
 *   - `onchain.json`  — `OnchainProofJson`   (optional)
 *   - `labels.json`   — `LabelsJson`
 *   - `MANIFEST.txt`  — `ManifestEntry[]` (see `../crypto/manifest`)
 */

/**
 * `merkle.json` — the inclusion proof for one leaf in one segment.
 *
 * Verifiers walk `audit_path` bottom-up using RFC 6962 domain
 * separation (`0x00 || leaf` for leaf hashes, `0x01 || left || right`
 * for nodes). The walk MUST close to the `root` field of the
 * bundle's `sth.json` for the segment — verifiers cross-check the
 * two files, not just `merkle.json` in isolation.
 *
 * `leaf_hash` is the RFC 6962 leaf hash:
 * `SHA-256(0x00 || envelope_canonical_bytes)`. It is NOT
 * `envelope_hash` (which omits the `0x00` prefix). A naive verifier
 * that checks `leaf_hash === envelope_hash` is wrong — they differ
 * by the prefix-and-rehash step.
 *
 * Hex fields are lowercase, no `0x` prefix. `audit_path` is ordered
 * leaf-to-root and its length equals `ceil(log2(tree_size))` for the
 * segment's tree at the STH used.
 */
export interface MerkleProofJson {
  v: 1;
  segment: number;
  leaf_index: number;
  leaf_hash: string;
  audit_path: string[];
}

/**
 * `onchain.json` — optional. Present only when the segment has a
 * confirmed `anchor_checkpoint` row whose `tree_size` covers
 * `merkle.json.leaf_index` and whose `root` matches the bundle's
 * `sth.json.root`.
 *
 * The bundle service refuses to assemble a bundle if an attestation
 * has been logged as `onchain` or `dual` mode but no confirmed
 * receipt exists — i.e. this file is present iff the on-chain claim
 * is substantiated server-side at build time. Per
 * ARCHITECTURE.md §8 D.7, `verify.sh` step 6 is informational only;
 * absence of this file does NOT weaken the proof's off-chain checks.
 *
 * `chain` uses canonical short names matching the on-chain anchor
 * service. `contract` is the registry address as a 0x-prefixed
 * checksummed hex string. `tx` is the tx hash. `block` is the block
 * number containing the tx. `tree_size` and `root` MUST match the
 * corresponding fields of `sth.json`.
 */
export interface OnchainProofJson {
  v: 1;
  chain: "base-mainnet" | "base-sepolia";
  contract: `0x${string}`;
  tx: `0x${string}`;
  block: number;
  segment: number;
  tree_size: number;
  root: string;
}

/**
 * One label entry in `labels.json`.
 *
 * The discriminator is the presence of the `salt` field — `salt`
 * appears ONLY when the bundle was built with the matching label
 * name in the reveal-set query parameter. A verifier seeing a `salt`
 * field MUST compute
 *
 *   SHA-256(name + ":" + String(value) + ":" + salt)
 *
 * and check it equals `commit`. Mismatch = the bundle was tampered
 * with or the salt is for a different label.
 *
 * Unrevealed labels have NO `salt` and NO `value` field. Bundle
 * builders MUST default to unrevealed; salts only ship when
 * explicitly requested. SDK consumers MUST NOT render salt values
 * outside an explicit "reveal" UI; logging `salt` at any level is a
 * privacy bug.
 */
export interface RevealedLabel {
  name: string;
  value: boolean | string | number;
  salt: string;
  commit: string;
  public_value?: boolean | string | number;
}

export interface UnrevealedLabel {
  name: string;
  commit: string;
  public_value?: boolean | string | number;
}

export type BundleLabel = RevealedLabel | UnrevealedLabel;

/**
 * `labels.json`. Always present, even when the envelope has zero
 * labels (in that case `labels` is the empty list). The empty-list
 * sentinel is non-negotiable so verifiers can unconditionally
 * attempt to read this file without first checking its existence.
 */
export interface LabelsJson {
  v: 1;
  labels: BundleLabel[];
}

/**
 * Type guard — narrow a `BundleLabel` to the revealed variant.
 * Use to gate any UI that needs to display the salt-recompute step
 * (and only that UI — never log the salt).
 */
export function isRevealedLabel(l: BundleLabel): l is RevealedLabel {
  return (l as RevealedLabel).salt !== undefined;
}

/**
 * One row in `MANIFEST.txt`. `path` is the bundle-relative path
 * (POSIX forward-slashes); `sha256` is the lowercase hex digest of
 * the file's contents. The on-disk format is sha256sum-compatible.
 */
export interface ManifestEntry {
  path: string;
  sha256: string;
}

/**
 * Canonical bundle filenames. Renaming any of these is a breaking
 * change to every historical bundle's `verify.sh` script. Treat as
 * append-only.
 */
export const BUNDLE_FILES = {
  MANIFEST: "MANIFEST.txt",
  ENVELOPE: "envelope.json",
  ENVELOPE_HASH: "envelope.hash",
  ISSUER_PEM: "issuer.pem",
  LABELS: "labels.json",
  MASTER_PEM: "master.pem",
  MERKLE: "merkle.json",
  ONCHAIN: "onchain.json",
  SIGNATURE: "signature.bin",
  STH: "sth.json",
  VERIFY_SCRIPT: "verify.sh",
  MERKLE_WALK_HELPER: "merkle-walk",
  TS_DIGICERT: "timestamps/digicert.tsr",
  TS_DIGICERT_CA: "timestamps/digicert-ca.pem",
  TS_SECTIGO: "timestamps/sectigo.tsr",
  TS_SECTIGO_CA: "timestamps/sectigo-ca.pem",
} as const;

export const BUNDLE_SUFFIX = ".dpiv-bundle";
