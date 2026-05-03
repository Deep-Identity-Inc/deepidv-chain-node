/**
 * merkle.spec.ts
 * ------------------------------------------------------------
 * RFC 6962 inclusion-proof verification.
 *
 * Generates a small tree from synthetic leaves, builds inclusion
 * proofs the same way the backend's anchor service does, then
 * round-trips through verifyInclusion. Also checks the negative
 * cases — wrong root, wrong index, tampered audit path.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  leafHash,
  nodeHash,
  verifyInclusion,
  verifyConsistency,
} from "../src/crypto/merkle.js";

/** Reference tree-builder for tests only — same RFC 6962 semantics. */
function largestPow2Less(n: number): number {
  if (n < 2) return 0;
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

function merkleRoot(leaves: Buffer[]): Buffer {
  if (leaves.length === 0) return createHash("sha256").digest();
  if (leaves.length === 1) return leaves[0] as Buffer;
  const k = largestPow2Less(leaves.length);
  return nodeHash(merkleRoot(leaves.slice(0, k)), merkleRoot(leaves.slice(k)));
}

function inclusionProof(
  leaves: Buffer[],
  m: number,
  start = 0,
  end = leaves.length,
): Buffer[] {
  const n = end - start;
  if (n <= 1) return [];
  const k = largestPow2Less(n);
  if (m < k) {
    const sub = inclusionProof(leaves, m, start, start + k);
    sub.push(merkleRoot(leaves.slice(start + k, end)));
    return sub;
  }
  const sub = inclusionProof(leaves, m - k, start + k, end);
  sub.push(merkleRoot(leaves.slice(start, start + k)));
  return sub;
}

function makeLeaves(n: number): Buffer[] {
  return Array.from({ length: n }, (_, i) =>
    leafHash(Buffer.from(`leaf-${i}`)),
  );
}

test("merkle: leafHash domain-separates with 0x00", () => {
  const direct = createHash("sha256")
    .update(Buffer.from([0x00]))
    .update(Buffer.from("hello"))
    .digest();
  assert.deepEqual(leafHash(Buffer.from("hello")), direct);
});

test("merkle: nodeHash domain-separates with 0x01", () => {
  const left = leafHash(Buffer.from("a"));
  const right = leafHash(Buffer.from("b"));
  const direct = createHash("sha256")
    .update(Buffer.from([0x01]))
    .update(left)
    .update(right)
    .digest();
  assert.deepEqual(nodeHash(left, right), direct);
});

test("merkle: verifyInclusion round-trips for power-of-two trees", () => {
  for (const size of [1, 2, 4, 8, 16, 64]) {
    const leaves = makeLeaves(size);
    const root = merkleRoot(leaves);
    for (let i = 0; i < size; i++) {
      const path = inclusionProof(leaves, i);
      assert.equal(
        verifyInclusion(leaves[i] as Buffer, i, size, path, root),
        true,
        `power-of-two: size=${size} idx=${i}`,
      );
    }
  }
});

test("merkle: verifyInclusion round-trips for non-power-of-two trees", () => {
  for (const size of [3, 5, 7, 13, 100]) {
    const leaves = makeLeaves(size);
    const root = merkleRoot(leaves);
    for (let i = 0; i < size; i++) {
      const path = inclusionProof(leaves, i);
      assert.equal(
        verifyInclusion(leaves[i] as Buffer, i, size, path, root),
        true,
        `non-power-of-two: size=${size} idx=${i}`,
      );
    }
  }
});

test("merkle: verifyInclusion rejects a tampered audit path", () => {
  const leaves = makeLeaves(8);
  const root = merkleRoot(leaves);
  const path = inclusionProof(leaves, 3);
  const tampered = [...path];
  tampered[0] = leafHash(Buffer.from("evil"));
  assert.equal(
    verifyInclusion(leaves[3] as Buffer, 3, 8, tampered, root),
    false,
  );
});

test("merkle: verifyInclusion rejects a wrong leaf index", () => {
  const leaves = makeLeaves(8);
  const root = merkleRoot(leaves);
  const path = inclusionProof(leaves, 3);
  assert.equal(verifyInclusion(leaves[3] as Buffer, 4, 8, path, root), false);
});

test("merkle: verifyInclusion rejects an out-of-range index", () => {
  const leaves = makeLeaves(8);
  const root = merkleRoot(leaves);
  const path = inclusionProof(leaves, 7);
  assert.equal(
    verifyInclusion(leaves[7] as Buffer, 8, 8, path, root),
    false,
    "m >= n must short-circuit to false",
  );
});

test("merkle: verifyInclusion rejects an empty tree", () => {
  assert.equal(
    verifyInclusion(Buffer.alloc(32), 0, 0, [], Buffer.alloc(32)),
    false,
  );
});

test("merkle: verifyConsistency m===n requires empty proof + equal roots", () => {
  const leaves = makeLeaves(8);
  const root = merkleRoot(leaves);
  assert.equal(verifyConsistency(root, root, 8, 8, []), true);
  assert.equal(verifyConsistency(root, root, 8, 8, [Buffer.alloc(32)]), false);
});

test("merkle: verifyConsistency m===0 requires empty proof", () => {
  const leaves = makeLeaves(8);
  const root = merkleRoot(leaves);
  assert.equal(verifyConsistency(Buffer.alloc(32), root, 0, 8, []), true);
});
