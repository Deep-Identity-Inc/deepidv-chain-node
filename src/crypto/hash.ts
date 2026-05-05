/**
 * Hash primitives — SHA-256 over Buffers and strings, plus the
 * canonical envelope-hash and STH-hash entry points.
 *
 * Uses `node:crypto` only. Browser / non-Node runtimes are not
 * supported in v1; if a Phase 2 use case needs them we can swap in
 * `globalThis.crypto.subtle` behind a thin abstraction.
 */

import { createHash } from "node:crypto";
import { jcs } from "./jcs.js";

export function sha256(buf: Buffer | Uint8Array | string): Buffer {
  const input =
    typeof buf === "string"
      ? buf
      : Buffer.isBuffer(buf)
        ? buf
        : Buffer.from(buf);
  return createHash("sha256").update(input).digest();
}

export function sha256Hex(buf: Buffer | Uint8Array | string): string {
  return sha256(buf).toString("hex");
}

/**
 * Canonical envelope hash.
 *
 * Per ARCHITECTURE.md §5, the envelope does not contain a signature.
 * Defensively strip any `sig` field before hashing — protects
 * against dynamic callers (e.g. negative-case tests, or a deserialized
 * pre-spec envelope) that might include one.
 *
 * The result is the value the issuer signs, the value emitted as
 * `envelope_hash` everywhere, and the value verifiers compare to the
 * `envelope.hash` file inside a bundle.
 */
export function envelopeHash(envelope: Record<string, unknown>): string {
  const withoutSig: Record<string, unknown> = { ...envelope };
  delete withoutSig.sig;
  return sha256Hex(jcs(withoutSig));
}

/**
 * Canonical STH hash.
 *
 * Per ARCHITECTURE.md §6.3, the chain-master signature is stored in
 * the `master_sig` field on the wire form. Strip both `master_sig`
 * and the legacy `sig` (defensively, for any pre-M03 STHs that
 * might still be in flight) before hashing.
 *
 * After stripping, JCS sorts the remaining keys lexically — the
 * preimage byte order is `alg, checkpoint, key_id, root, segment,
 * timestamp, tree_size, v`.
 */
export function sthHash(sth: Record<string, unknown>): string {
  const withoutSigs: Record<string, unknown> = { ...sth };
  delete withoutSigs.master_sig;
  delete withoutSigs.sig;
  return sha256Hex(jcs(withoutSigs));
}
