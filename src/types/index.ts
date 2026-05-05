/**
 * `@deepidv/chain/types` — wire shapes for everything in the chain
 * layer.
 *
 * Three groups:
 *   1. Envelope and label commits (mint side, ARCHITECTURE.md §5)
 *   2. STH (transparency log side, §6.3)
 *   3. Bundle JSON files (proof side, §8) and registry API responses
 *      (M06a, `api.proof.deepidv.com/v1`)
 *
 * All shapes are wire-format types — what the SDK reads off the
 * network or out of a `.dpiv-bundle`. The crypto primitives in
 * `@deepidv/chain/crypto` operate on these shapes.
 */

export type {
  EnvelopeVersion,
  SigningAlg,
  RecordType,
  LabelCommit,
  EnvelopeV1,
  Envelope,
} from "./envelope.js";

export type { STH } from "./sth.js";

export type {
  MerkleProofJson,
  OnchainProofJson,
  RevealedLabel,
  UnrevealedLabel,
  BundleLabel,
  LabelsJson,
  ManifestEntry,
} from "./bundle.js";

export { isRevealedLabel, BUNDLE_FILES, BUNDLE_SUFFIX } from "./bundle.js";

export type {
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
} from "./api.js";
