/**
 * RFC 6962 Certificate-Transparency-style Merkle tree primitives.
 *
 * - Domain-separated leaf and node prefixes (0x00, 0x01) to prevent
 *   second-preimage / length-extension attacks.
 * - SHA-256 only in v1 (matches shared-deps default; SHA-512 lives
 *   on the backend tree but is irrelevant to v1 verification).
 * - Verification only: this SDK never builds trees, only walks
 *   audit paths. Tree construction lives in the backend
 *   (`anchor-service` Lambda) and is unnecessary here.
 *
 * Mirrors `shared-deps/chain/lib/merkle.ts::leafHash`,
 * `nodeHash`, `verifyInclusion`. Reimplemented for the same
 * dependency-zero reasons as `./jcs.ts`.
 */

import { createHash } from "node:crypto";

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

function h(...parts: Buffer[]): Buffer {
  const d = createHash("sha256");
  for (const p of parts) d.update(p);
  return d.digest();
}

/**
 * Hash a leaf payload (canonical envelope bytes).
 *
 * The result is the bundle's `merkle.json::leaf_hash` — NOT the
 * envelope hash. The two differ by the `0x00` prefix; a verifier
 * that compares them directly is wrong.
 */
export function leafHash(payload: Buffer | Uint8Array): Buffer {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  return h(LEAF_PREFIX, buf);
}

/** Hash an internal node from two children. */
export function nodeHash(left: Buffer, right: Buffer): Buffer {
  return h(NODE_PREFIX, left, right);
}

/**
 * Verify an inclusion proof.
 *
 * Recomputes the root from `(leaf, m, n, path)` and compares against
 * `expectedRoot`. Consumes the path bottom-up (closest-to-leaf first),
 * matching the RFC 6962 §2.1.1 audit-path format and the order that
 * the backend's `inclusionProof` produces.
 *
 * Handles non-power-of-two sizes correctly: at levels where a subtree
 * is "promoted" without a sibling (`fn === sn`), the walk keeps
 * climbing until it encounters the next real sibling.
 */
export function verifyInclusion(
  leaf: Buffer,
  m: number,
  n: number,
  path: Buffer[],
  expectedRoot: Buffer,
): boolean {
  if (m >= n || n === 0) return false;

  let fn = m;
  let sn = n - 1;
  let r = leaf;

  for (const sibling of path) {
    if (sn === 0) return false; // over-long path
    if ((fn & 1) === 1 || fn === sn) {
      r = nodeHash(sibling, r);
      while ((fn & 1) === 0 && fn !== 0) {
        fn >>= 1;
        sn >>= 1;
      }
    } else {
      r = nodeHash(r, sibling);
    }
    fn >>= 1;
    sn >>= 1;
  }

  return sn === 0 && r.equals(expectedRoot);
}

/**
 * Verify a consistency proof: old root (size m) → new root (size n).
 * RFC 6962 §2.1.4.
 *
 * Used by witness implementations and the consistency-check feature
 * in the Governance Console (M10). Verification only — no proof
 * construction in v1.
 */
export function verifyConsistency(
  oldRoot: Buffer,
  newRoot: Buffer,
  m: number,
  n: number,
  proof: Buffer[],
): boolean {
  if (m < 0 || m > n) return false;
  if (m === n) return proof.length === 0 && oldRoot.equals(newRoot);
  if (m === 0) return proof.length === 0;

  let fn = m - 1;
  let sn = n - 1;
  while ((fn & 1) === 1) {
    fn >>= 1;
    sn >>= 1;
  }

  let i = 0;
  let oldHash: Buffer;
  let newHash: Buffer;

  if (fn === 0) {
    oldHash = oldRoot;
    newHash = oldRoot;
  } else {
    if (proof.length === 0) return false;
    oldHash = proof[i] as Buffer;
    newHash = proof[i] as Buffer;
    i++;
  }

  while (sn !== 0) {
    if (i >= proof.length) return false;
    if ((fn & 1) === 1 || fn === sn) {
      const sib = proof[i] as Buffer;
      oldHash = nodeHash(sib, oldHash);
      newHash = nodeHash(sib, newHash);
      while ((fn & 1) === 0 && fn !== 0) {
        fn >>= 1;
        sn >>= 1;
      }
    } else {
      const sib = proof[i] as Buffer;
      newHash = nodeHash(newHash, sib);
    }
    i++;
    fn >>= 1;
    sn >>= 1;
  }

  return (
    i === proof.length && oldHash.equals(oldRoot) && newHash.equals(newRoot)
  );
}

export const hex = (b: Buffer): string => b.toString("hex");
export const unhex = (s: string): Buffer => Buffer.from(s, "hex");
