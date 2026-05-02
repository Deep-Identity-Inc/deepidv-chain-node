/**
 * JCS (RFC 8785) canonicalization.
 *
 * Deterministic JSON serialization. Without this, two servers might
 * produce different byte strings for the same object, breaking hash
 * equality and verification. JCS sorts object keys lexically and
 * uses stable number / string formatting.
 *
 * This implementation matches Python's
 *
 *   json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
 *
 * for all JSON-safe values used in EnvelopeV1, STH, and bundle JSON
 * files. Cross-language parity is a hard invariant — any change here
 * requires a coordinated update to the Python SDK's equivalent
 * function and a re-run of the parity fixtures (see
 * `test/envelope-parity.spec.ts` and `test/sth-parity.spec.ts`).
 *
 * Functionally equivalent to `shared-deps/chain/lib/crypto.ts::jcs`.
 * Reimplemented here rather than imported because:
 *   - the SDK has zero runtime dependencies (shared-deps pulls in
 *     `@aws-sdk/client-kms` for backend signing);
 *   - duplicating ~25 lines is cheaper than a peer-dep treadmill;
 *   - the parity tests cross-validate byte-for-byte against
 *     shared-deps' fixture, so drift is caught at CI time.
 */

export function jcs(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("JCS: non-finite number");
    }
    return value.toString();
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(jcs).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + jcs(obj[k]))
        .join(",") +
      "}"
    );
  }
  throw new Error("JCS: unsupported type " + typeof value);
}
