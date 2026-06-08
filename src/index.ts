/**
 * @deepidv/chain — Node SDK entry point.
 *
 * Public surface for the chain layer at api.proof.deepidv.com:
 *   - typed clients for the public registry API
 *   - typed envelope, STH, and bundle shapes
 *   - canonicalization (JCS) and hashing primitives that are
 *     byte-identical with the Python SDK and the backend
 *   - partial offline bundle verification (5 of 6 checks per
 *     ARCHITECTURE.md §8 D.5; TSA tokens are deliberately skipped)
 *
 * Subpath imports are supported and recommended for tree-shakability:
 *
 *   import { createClient } from "@deepidv/chain/client";
 *   import { verifyBundle } from "@deepidv/chain/verify";
 *   import { jcs, envelopeHash } from "@deepidv/chain/crypto";
 *   import type { AttestationDetail } from "@deepidv/chain/types";
 *
 * Or pull everything from the root export.
 */

export const SDK_VERSION = "1.1.0";

// Wire-format types.
export type {
  EnvelopeVersion,
  SigningAlg,
  RecordType,
  LabelCommit,
  EnvelopeV1,
  Envelope,
  STH,
  MerkleProofJson,
  OnchainProofJson,
  RevealedLabel,
  UnrevealedLabel,
  BundleLabel,
  LabelsJson,
  ManifestEntry,
  AnchorNetwork,
  ChainAnchor,
  RegistryLabelView,
  RegistryRow,
  RegistryPage,
  InclusionView,
  SthView,
  AttestationDetail,
  SthListResponse,
  SegmentDetail,
  IssuerDetail,
  ConsistencyProofResponse,
  StreamEvent,
  RegistryListFilters,
} from "./types/index.js";
export { isRevealedLabel, BUNDLE_FILES, BUNDLE_SUFFIX } from "./types/index.js";

// Errors.
export {
  DeepidvApiError,
  DeepidvAuthError,
  DeepidvNotFoundError,
  DeepidvRateLimitError,
  DeepidvServerError,
  DeepidvNetworkError,
  statusToErrorClass,
  type DeepidvApiErrorContext,
} from "./errors/index.js";

// Crypto primitives.
export {
  jcs,
  sha256,
  sha256Hex,
  envelopeHash,
  sthHash,
  serializeManifest,
  parseManifest,
  isValidSha256Hex,
  leafHash,
  nodeHash,
  verifyInclusion,
  verifyConsistency,
  hex,
  unhex,
} from "./crypto/index.js";

// API client.
export {
  createClient,
  DeepidvChainClient,
  type ClientOptions,
  type FetchLike,
  type RequestOptions,
} from "./client/index.js";

// Bundle verification.
export {
  verifyBundle,
  unzipBundle,
  type VerifyResult,
  type VerifyChecks,
  type BundleFiles,
} from "./verify/index.js";
