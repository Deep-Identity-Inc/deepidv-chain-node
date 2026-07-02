/**
 * Envelope shapes for the deepidv chain layer.
 *
 * Mirrors `shared-deps/chain/lib/types.ts`, which is the source of
 * truth. Any drift between this file and ARCHITECTURE.md §5 is a bug
 * — the architecture doc wins.
 *
 * The envelope is what a tenant verifies with: it carries the claim
 * hash, the issuer id, the subject pseudonym, the dual-TSA timestamps,
 * and a record-type tag. Signatures live in the proof bundle's
 * `signature.bin`, NOT in the envelope (per ARCHITECTURE.md §5 the
 * envelope IS what's signed; embedding the signature would create a
 * circular hash preimage).
 */

/**
 * Envelope format version.
 *
 *   v = 1  current. Plain envelope with `claim_hash` as a SHA-256
 *          digest of the canonical claim body stored by the tenant.
 *   v = 2  reserved for a future schema evolution.
 *   v = 3  TripleLock (Phase 2). Three nested AES-256-GCM layers; the
 *          outer key is the subject's, so not even deepidv can decrypt
 *          without the subject's explicit unlock.
 *
 * `v` is included in the hash preimage, so v1 envelopes verified
 * today remain verifiable indefinitely regardless of what v2+
 * envelopes look like.
 */
export type EnvelopeVersion = 1 | 2 | 3;

/**
 * Signing algorithm identifier — used by STH preimages, not by the v1
 * envelope itself (envelope algorithm is implicit in `v = 1`).
 *
 * v1 launches with ECDSA over NIST P-256 with SHA-256 (AWS KMS spec
 * `ECC_NIST_P256`, signing algorithm `ECDSA_SHA_256`). When v2+ ships
 * with a different algorithm, this union widens.
 */
export type SigningAlg = "ECDSA_P256_SHA256";

/**
 * Record type for the v1 envelope's `t` field.
 *
 * - `IDV` is the only record type emitted by the v1 mint Lambda.
 * - `BIO`, `DOC`, and `ADDR` are reserved for Phase 2 (per-capability
 *   event emission) and are included in the union as a forward-
 *   compatibility marker. Bundles tagged `BIO`, `DOC`, or `ADDR` will
 *   not appear in v1; do not author them client-side.
 * - `WIT` is reserved for Phase 3 — Witness attestation (DIDV-481/483).
 * - `AGT` is reserved for Phase 3 — Agent identity (DIDV-488/489).
 *
 * `RSK | AML | AGR | ACT` are deliberately NOT in this union. Adding
 * them later is a semver-minor bump in the SDK, semver-major in the
 * envelope schema.
 */
export type RecordType =
  | "IDV" // v1 active
  | "BIO" // reserved — Phase 2
  | "DOC" // reserved — Phase 2
  | "ADDR" // reserved — Phase 2
  | "WIT" // reserved — Phase 3 (witness attestation, DIDV-483)
  | "AGT"; // reserved — Phase 3 (agent identity, DIDV-489)

/**
 * Label commitment as it appears in the envelope.
 *
 * `commit` is `"sha256:<hex>"` of
 * `SHA-256(name || ":" || value || ":" || salt_16_hex)`.
 *
 * `public_value` appears only when the issuer marked the label
 * non-sensitive at mint time. Sensitive labels omit it; the subject
 * can reveal the salt later through a proof bundle.
 *
 * Salts are NOT in the envelope — they live server-side on the
 * chain-log row and ship to the bundle only when the bundle was
 * built with an explicit reveal-set (see `RevealedLabel` in
 * `bundle.ts`).
 */
export interface LabelCommit {
  name: string;
  commit: string;
  public_value?: boolean | string | number;
}

/**
 * Canonical v1 envelope. Matches ARCHITECTURE.md §5 exactly.
 *
 * When hashing (see `envelopeHash` in `../crypto`), the envelope is
 * JCS-canonicalized (RFC 8785) then SHA-256'd.
 */
export interface EnvelopeV1 {
  v: 1;
  t: RecordType;
  /** ULID with `attest_` prefix — e.g. `"attest_01JAXK9F7W..."`. */
  id: string;
  /** Opaque tenant id; the Organizations-{env} table's id column. */
  tenant: string;
  /** Human-readable issuer id — e.g. `"iss_acme_prod"`. */
  issuer: string;
  /** `"sha256:<hex>"` — salted pseudonym, never the raw identifier. */
  subject: string;
  /** `"sha256:<hex>"` of the canonical claim body (tenant-side). */
  claim_hash: string;
  labels?: LabelCommit[];
  /**
   * Dual RFC 3161 timestamps. At least one MUST be present at mint
   * time. Values are `"b64:<base64 DER token>"`.
   */
  rts: {
    digicert?: string;
    sectigo?: string;
  };
  /** ISO 8601 — derived from the upstream Session's `verifiedAt`. */
  minted_at: string;
  /** ULID tying this envelope to the originating SNS message. */
  correlation_id: string;
}

/**
 * Narrow alias — extend to a discriminated union when v2/v3
 * envelopes ship.
 */
export type Envelope = EnvelopeV1;
