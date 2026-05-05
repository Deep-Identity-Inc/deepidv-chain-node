# Changelog

All notable changes to `@deepidv/chain` are documented in this
file. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-05-02

Initial GA release of the Node.js / TypeScript SDK for the deepidv
chain layer (Module 07 of the chain-layer build).

### Added

- **Public registry API client** at `api.proof.deepidv.com/v1`.
  Read methods: `getAttestation`, `listRegistry`, `getIssuer`,
  `getSegment`, `listSths`, `getConsistencyProof`, `getLog`,
  `downloadBundle`. Pluggable `fetch`, default 15 s timeout via
  `AbortSignal.timeout`, per-request `AbortSignal` support.
- **Live SSE stream** — `client.streamAttestations({signal})`
  returns an `AsyncIterable<StreamEvent>` over `/v1/stream` with
  built-in exponential backoff, jitter, and `Last-Event-ID`
  resumption. Hand-rolled parser; no third-party SSE dependency.
- **Typed error hierarchy** rooted at `DeepidvApiError`:
  `DeepidvAuthError` (401/403), `DeepidvNotFoundError` (404),
  `DeepidvRateLimitError` (429, parses `Retry-After`),
  `DeepidvServerError` (5xx), `DeepidvNetworkError`. Prototype
  chain re-set in every constructor so `instanceof` works across
  the dual ESM/CJS build.
- **Crypto primitives**: JCS (RFC 8785) canonical JSON,
  `envelopeHash`, `sthHash` (both strip `sig` / `master_sig`
  defensively), sha256sum-compatible `serializeManifest` /
  `parseManifest`, RFC 6962 `leafHash` / `nodeHash` /
  `verifyInclusion` / `verifyConsistency`.
- **Partial offline bundle verification** — `verifyBundle()`
  performs five of the six checks defined in ARCHITECTURE.md §8
  D.5: envelope hash, issuer signature, Merkle inclusion,
  chain-master STH signature, and on-chain anchor structural
  cross-check. RFC 3161 TSA token verification is **deliberately
  skipped** and reported as the literal string `"skipped"` —
  callers needing the full six-of-six check run the bundle's own
  `verify.sh`.
- **Stored-method ZIP reader** — refuses ZIP64, backslash paths,
  absolute paths, parent-directory traversal, and any compression
  method other than STORED. `.dpiv-bundle` files are STORED per
  ARCHITECTURE.md §8 D.4.
- **Wire-format types** for `EnvelopeV1`, `STH`, `MerkleProofJson`,
  `OnchainProofJson`, `LabelsJson`, `ManifestEntry`, plus the full
  set of registry API responses (`AttestationDetail`,
  `RegistryPage`, `IssuerDetail`, `SegmentDetail`,
  `SthListResponse`, `ConsistencyProofResponse`, `StreamEvent`).
- **Cross-language parity** — three shared fixtures locked down
  byte-for-byte against `shared-deps` and the Python SDK:
  - `envelopeHash(parity-envelope)` =
    `03507fb35af9389513dc25baa9a8a7a609cfa240a300965187fec9426734ba26`
  - `sthHash(parity-sth)` =
    `2c1e1d7e3898f93c355cd25866bb37f598ee19cce1b05eda049ccdbf51f2a7e7`
  - `sha256(serializeManifest(parity-manifest))` =
    `fe6352dc308709902830020ce9e0fe28fa025365bab677326d19b75911852fbd`
- **Dual ESM + CJS build** with subpath exports for `./types`,
  `./crypto`, `./verify`, `./client`. Declaration files for both
  module systems.
- **Examples**: `examples/verify-bundle.ts`,
  `examples/registry-search.ts`, `examples/sse-stream.ts`. Each
  runnable via `npx tsx`.

### Verification scope (read this)

The SDK's `verifyBundle()` is a partial verifier by design:

- `checks.tsa_tokens === "skipped"` — RFC 3161 timestamp tokens
  are not verified in-process. The bundle's `verify.sh` is the
  canonical TSA verifier (uses `openssl ts -verify` against the
  pinned DigiCert and Sectigo CA chains).
- `checks.onchain_anchor` — when `onchain.json` is present, its
  `(segment, tree_size, root)` are cross-checked against
  `sth.json`. The on-chain transaction itself is **not** queried;
  per ARCHITECTURE.md §8 D.7 even `verify.sh` treats the on-chain
  step as informational.

### Constraints honored

- Node ≥ 20. Uses global `fetch`, `AbortSignal.timeout`,
  `ReadableStream`, and `node:crypto` only.
- Zero runtime dependencies. The SDK does not depend on
  `@aws-sdk/client-kms`, `@peculiar/x509`, `jose`, `node-fetch`,
  `axios`, `eventsource`, or any other third-party package.
- `recordType` v1 union is `IDV | BIO | DOC | ADDR`. `IDV` is
  active; `BIO`, `DOC`, `ADDR` are reserved for Phase 2 and
  documented as such. `RSK | AML | AGR | ACT` are not in the
  union — adding them later is a semver-minor bump.

### Notes on the prior 0.0.1 release

The package name `@deepidv/chain` was registered as a placeholder
on npm at version `0.0.1` while the chain layer was being built.
That release contained only a `LICENSE`, a one-line README, and an
empty `module.exports = {}`. `1.0.0` is the first functional
release; do not depend on `0.0.1`.

[1.0.0]: https://github.com/Deep-Identity-Inc/deepidv-chain-node/releases/tag/v1.0.0
