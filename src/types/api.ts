/**
 * Public registry API response types — `api.proof.deepidv.com/v1`.
 *
 * Mirrors the live shapes confirmed against the staging deploy at
 * 2026-05-01 (cross-checked with `proof-deepidv/src/lib/api/types.ts`,
 * the M06b reference). Where the M06.md spec disagreed with the
 * deployed surface, the deployed surface wins (e.g. the singular
 * `/v1/attestation/:id` route).
 *
 * All endpoints are unauthenticated — the registry is a public
 * transparency log. Authenticated routes (`/governance/*`,
 * `/admin/*`) are not part of this SDK; they belong to the
 * Governance Console (M10).
 *
 * Conventions:
 *   - Hex fields (root, leafHash, txHash) are lowercase with no `0x`
 *     prefix unless explicitly typed as `0x${string}`.
 *   - Timestamps are ISO 8601 UTC with `Z` suffix.
 *   - Cursor pagination — `nextCursor: string | null`. `null` means
 *     "no more pages".
 */

import type { RecordType } from "./envelope.js";
import type { Envelope } from "./envelope.js";

/**
 * Network short name for the on-chain anchor.
 *
 * The registry API returns `"base"` for mainnet (NOT `"base-mainnet"`,
 * which is what `OnchainProofJson` in the bundle uses). The bundle
 * shape and the API shape diverge here intentionally — bundles need a
 * canonical name that won't drift, while the registry leans on the
 * network's vernacular.
 */
export type AnchorNetwork = "base-sepolia" | "base";

export interface ChainAnchor {
  network: AnchorNetwork;
  txHash: `0x${string}`;
  blockNumber?: number;
  treeRootHex: string;
  timestamp: string;
}

export interface RegistryLabelView {
  name: string;
  /**
   * `true` when the registry has a `public_value` for this label
   * (issuer marked it non-sensitive at mint time). Subjects can
   * still later reveal hidden labels via a proof bundle.
   */
  revealed?: boolean;
  /** Present iff `revealed === true`. */
  value?: string;
}

export interface RegistryRow {
  id: string;
  recordType: RecordType;
  issuerId: string;
  mintedAt: string;
  segment: number;
  leafIndex: number;
  labels: RegistryLabelView[];
  anchored: boolean;
  envelopeHash?: string;
}

export interface RegistryPage {
  items: RegistryRow[];
  nextCursor: string | null;
}

export interface InclusionView {
  treeSize: number;
  leafIndex: number;
  auditPath: string[];
  rootHex: string;
}

export interface SthView {
  version: string;
  treeSize: number;
  rootHex: string;
  timestamp: string;
  checkpoint: boolean;
  closure?: boolean;
  masterSigB64?: string;
  keyId?: string;
  alg?: string;
  anchor?: ChainAnchor;
}

export interface AttestationDetail {
  id: string;
  recordType: RecordType;
  segment: number;
  leafIndex: number;
  envelopeHash: string;
  issuerId: string;
  mintedAt: string;
  labels: RegistryLabelView[];
  envelope: Envelope;
  inclusion?: InclusionView;
  sth?: SthView;
  anchor?: ChainAnchor;
}

export interface SthListResponse {
  segment: number;
  items: SthView[];
}

export interface SegmentDetail {
  segment: number;
  treeSize: number;
  closed: boolean;
  sparkline: Array<{ ts: string; treeSize: number }>;
  sths: SthView[];
  anchors?: ChainAnchor[];
}

export interface IssuerDetail {
  id: string;
  status: "active" | "rotating" | "revoked";
  publicKeyPem: string;
  rotations: Array<{
    at: string;
    reason?: string;
    previousKeyFingerprint?: string;
  }>;
  recentAttestations: RegistryRow[];
}

/**
 * Consistency proof between two STHs in the same segment.
 *
 * The `proof` array is ordered as RFC 6962 §2.1.2 specifies (consumed
 * by `verifyConsistency` in `../crypto`). Verifiers check that
 * `oldRoot` and `newRoot` match the `rootHex` fields of the matching
 * STHs in the registry.
 */
export interface ConsistencyProofResponse {
  segment: number;
  fromTreeSize: number;
  toTreeSize: number;
  oldRootHex: string;
  newRootHex: string;
  proof: string[];
}

/**
 * Live attestation stream event over Server-Sent Events.
 *
 * The registry API exposes `/v1/stream` as a long-lived `text/event-
 * stream` that emits one JSON-encoded `StreamEvent` per `data:`
 * frame. The SDK's `streamAttestations()` AsyncIterable handles
 * reconnection with exponential backoff and surfaces these events
 * unchanged.
 *
 * Additional event `type` values may be added in minor versions; the
 * union is intentionally open at the SDK type level — consumers
 * should switch on `type` and ignore unknown variants rather than
 * exhaustiveness-check.
 */
export type StreamEvent =
  | {
      type: "attestation.minted";
      payload: {
        id: string;
        recordType: RecordType;
        issuerId: string;
        mintedAt: string;
        segment: number;
        leafIndex: number;
        envelopeHash?: string;
        anchored?: boolean;
      };
    }
  | {
      type: "sth.signed";
      payload: {
        segment: number;
        treeSize: number;
        rootHex: string;
        timestamp: string;
        checkpoint: boolean;
      };
    }
  | {
      type: "anchor.confirmed";
      payload: {
        segment: number;
        network: AnchorNetwork;
        txHash: `0x${string}`;
        treeRootHex: string;
      };
    };

/**
 * Re-export `STH` so `@deepidv/chain/types` is the one place to
 * grab any wire shape — envelope, sth, bundle, or api.
 */
export type { STH } from "./sth.js";

/** Filters accepted by `listRegistry`. */
export interface RegistryListFilters {
  type?: RecordType;
  issuer?: string;
  q?: string;
}
