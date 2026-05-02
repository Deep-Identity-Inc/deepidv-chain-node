/**
 * Signed Tree Head shapes.
 *
 * Mirrors `shared-deps/chain/lib/types.ts::STH`, which is the source
 * of truth. Any drift between this file and ARCHITECTURE.md §6.3 is
 * a bug — the architecture doc wins.
 *
 * The STH is produced by the `MasterSignSth` Step Function in M03 on
 * two triggers: an hourly checkpoint (EventBridge schedule, sets
 * `checkpoint: true`) and a segment closure when the tree fills to
 * 2^20 leaves or an operator forces a close (`checkpoint: false`).
 * Signed by the chain-master KMS key — IAM grants `kms:Sign` on that
 * key only to the Step Function execution role.
 *
 * # Canonical (JCS) sort order
 *
 * `sthHash` (in `../crypto`) strips `master_sig` (and the legacy
 * `sig`, defensively) before JCS-canonicalizing. JCS sorts keys
 * lexically, so the wire-bytes order for the hash preimage is
 * always:
 *
 *   alg, checkpoint, key_id, root, segment, timestamp, tree_size, v
 *
 * Any consumer that reconstructs the STH preimage independently
 * MUST produce the same byte sequence. Cross-language parity is
 * locked down by `test/sth-parity.spec.ts` against the same fixture
 * used by shared-deps and the Python SDK.
 */

import type { SigningAlg } from "./envelope.js";

export interface STH {
  v: 1;
  /** Currently always `"ECDSA_P256_SHA256"`. */
  alg: SigningAlg;
  /** Monotonically increasing, 0-indexed. */
  segment: number;
  /** Leaf count, 1..2^20 per segment. */
  tree_size: number;
  /** Hex, no `sha256:` prefix, lowercase. */
  root: string;
  /** ISO 8601 UTC with `Z` suffix. */
  timestamp: string;
  /** Chain-master KMS Key ARN or unqualified KeyId. */
  key_id: string;
  /** `true` = hourly checkpoint, `false` = segment closure. */
  checkpoint: boolean;
  /**
   * `master_sig` is base64 of the DER-encoded ECDSA signature
   * returned by AWS KMS (P-256 / SHA-256). Writers omit the field
   * when computing the preimage; verifiers strip it before hashing.
   * The `master_` prefix signals chain-master-key provenance and
   * disambiguates from issuer-produced envelope signatures.
   */
  master_sig?: string;
}
