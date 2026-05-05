# @deepidv/chain

Node.js / TypeScript SDK for the [deepidv](https://proof.deepidv.com)
chain layer.

Typed access to the public registry API at
`api.proof.deepidv.com`, plus partial offline verification of
`.dpiv-bundle` proof archives — five of the six checks defined in
the chain-layer architecture spec, performed in pure Node with zero
runtime dependencies.

> The deepidv chain layer is a public, append-only transparency log
> of identity-verification attestations: every verified session
> produces a signed, timestamped envelope, every envelope hashes
> into a Merkle tree, and every tree's root is signed by a
> chain-master key on a regular schedule and (optionally) anchored
> to Base. Read proofs anywhere; verify them anywhere.

## Install

```bash
npm install @deepidv/chain
# or
pnpm add @deepidv/chain
# or
yarn add @deepidv/chain
```

Requires Node **≥ 20** (uses the global `fetch`, `AbortSignal.timeout`,
`ReadableStream`, and `node:crypto.createPublicKey`).

## Quickstart

```ts
import { createClient, verifyBundle } from "@deepidv/chain";

// 1. Look up an attestation in the public registry.
const client = createClient({
  apiUrl: "https://api.proof.deepidv.com",
});
const attestation = await client.getAttestation("attest_01JTEST…");

// 2. Download the proof bundle.
const zipBytes = await client.downloadBundle(attestation.id);

// 3. Verify it offline (5 of 6 checks; see "Verification scope").
const result = await verifyBundle(zipBytes);
if (result.ok) {
  console.log("✓ verified", attestation.id);
} else {
  console.error("✗ failed:", result.reason);
}
```

## Subpath imports (recommended)

The package exposes four subpaths so you can pull in only what you
need:

```ts
import { createClient } from "@deepidv/chain/client";
import { verifyBundle } from "@deepidv/chain/verify";
import { jcs, envelopeHash, sthHash } from "@deepidv/chain/crypto";
import type { AttestationDetail, RegistryPage } from "@deepidv/chain/types";
```

Each subpath ships dual ESM + CJS with `.d.ts` declarations.

## API surface

### `createClient(options) → DeepidvChainClient`

| Method | Path | Returns |
| ------ | ---- | ------- |
| `getAttestation(id)` | `GET /v1/attestation/:id` | `AttestationDetail` |
| `listRegistry(filters)` | `GET /v1/registry` | `RegistryPage` |
| `getIssuer(id)` | `GET /v1/issuer/:id` | `IssuerDetail` |
| `getSegment(n)` | `GET /v1/segment/:n` | `SegmentDetail` |
| `listSths(segment)` | `GET /v1/sth?segment=` | `SthListResponse` |
| `getConsistencyProof(from, to, segment)` | `GET /v1/consistency` | `ConsistencyProofResponse` |
| `getLog()` | `GET /v1/log` | `{ segments: SegmentDetail[] }` |
| `downloadBundle(id)` | `GET /v1/bundle/:id` | `ArrayBuffer` |
| `streamAttestations({signal})` | `GET /v1/stream` (SSE) | `AsyncIterable<StreamEvent>` |

All methods accept an optional `{ signal, timeoutMs }` and throw
typed errors:

- `DeepidvAuthError` — 401 / 403
- `DeepidvNotFoundError` — 404
- `DeepidvRateLimitError` — 429 (parses `Retry-After` into
  `retryAfterSeconds`)
- `DeepidvServerError` — 5xx
- `DeepidvNetworkError` — fetch / DNS / abort
- `DeepidvApiError` — common base

```ts
import { DeepidvRateLimitError } from "@deepidv/chain";

try {
  await client.listRegistry();
} catch (err) {
  if (err instanceof DeepidvRateLimitError && err.retryAfterSeconds) {
    await new Promise((r) => setTimeout(r, err.retryAfterSeconds * 1000));
  }
  throw err;
}
```

### Live attestation stream

```ts
const ctrl = new AbortController();
for await (const ev of client.streamAttestations({ signal: ctrl.signal })) {
  if (ev.type === "attestation.minted") {
    console.log(ev.payload.id, ev.payload.recordType);
  }
}
```

The iterator manages reconnection internally — exponential backoff,
jittered, capped at 30 s, with `Last-Event-ID` resumption.
Aborting the signal stops iteration cleanly.

### Crypto primitives

```ts
import {
  jcs,
  sha256Hex,
  envelopeHash,
  sthHash,
  serializeManifest,
  parseManifest,
  leafHash,
  verifyInclusion,
} from "@deepidv/chain/crypto";

const h = envelopeHash({ v: 1, t: "IDV", id: "attest_01", /* … */ });
//        ^- byte-identical with the Python SDK and the backend
```

JCS (RFC 8785) canonicalization, RFC 6962 leaf/node hashing, and
sha256sum-compatible MANIFEST.txt serialization. Cross-language
parity is locked down by fixture tests against the same constants
the Python SDK and the backend assert.

## Verification scope

`verifyBundle()` performs **5 of 6** checks defined in the
ARCHITECTURE.md §8 D.5 spec:

| # | Check | Result type |
| - | ----- | ----------- |
| 1 | `envelope_hash` | `boolean` |
| 2 | `issuer_signature` | `boolean` |
| 3 | `tsa_tokens` | **`"skipped"`** |
| 4 | `merkle_inclusion` | `boolean` |
| 5 | `master_sth_signature` | `boolean` |
| 6 | `onchain_anchor` | `boolean \| "absent"` |

> **TSA token verification (RFC 3161 against the DigiCert and
> Sectigo CA chains) is deliberately skipped.** Pulling a full
> ASN.1 + RFC 3161 verifier into a zero-dependency SDK would add
> ~200 KB of transitive deps. The status is reported as the
> literal string `"skipped"` — never a boolean — so callers can't
> mistake it for a passing check.
>
> If you need full six-of-six verification, run the bundle's own
> `verify.sh` companion. It uses `openssl ts -verify` and is the
> canonical TSA verifier by design.

```ts
const r = await verifyBundle(zipBytes);
//   ↳  { ok, checks, skipped: ["tsa_tokens"], reason?, onchainReference? }

if (r.ok && r.checks.tsa_tokens === "skipped") {
  // 5 of 6 checks passed. Run verify.sh from the bundle for the
  // canonical TSA check if your use case requires it.
}
```

The on-chain anchor check (#6) is **informational only** — it
verifies the structural fields in `onchain.json` against
`sth.json` and exposes the on-chain reference, but does not call an
RPC. Live transaction confirmation is a `verify.sh` concern (and
even there is informational per ARCHITECTURE.md §8 D.7).

## Privacy

- Claim bodies are never on the wire — the envelope carries only
  `claim_hash`. Tenants store the canonical claim themselves.
- Label salts are stored only when an attestation is built with an
  explicit reveal-set. A salt-bearing label is always the result of
  the subject opting to reveal it. **The SDK never logs salt
  values.** Consumers building UIs MUST gate any salt rendering
  behind an explicit reveal flow.
- The SDK does not send authentication headers. The public
  registry is unauthenticated by design — every attestation is
  globally readable, and the privacy model lives at the envelope
  level (subject pseudonym, claim hash) and the label layer
  (salted commitments).

## Versioning

Semver. The SDK is at `1.0.0` and tracks the chain layer's v1 wire
formats. Forward-compatibility is built in:

- New `recordType` values (e.g. `BIO`, `DOC`, `ADDR` in Phase 2)
  are semver-minor.
- New `StreamEvent.type` values are semver-minor — consumers
  switch on `type` and ignore unknowns.
- A new envelope version (v2, TripleLock v3) is semver-major.
- Drift in JCS canonicalization, MANIFEST.txt format, or the
  envelope/STH hash preimage is a breaking change requiring a
  coordinated update with the Python SDK and the backend's
  shared-deps. The fixture tests will fail loudly if you forget.

## Examples

See [`examples/`](./examples) for runnable scripts:

- `examples/registry-search.ts` — paginate the registry with
  filters
- `examples/verify-bundle.ts` — download + verify an attestation
- `examples/sse-stream.ts` — subscribe to live attestations

Run any example with:

```bash
npx tsx examples/verify-bundle.ts <attestation_id>
```

## Contributing

Issues and PRs welcome at
[github.com/Deep-Identity-Inc/deepidv-chain-node](https://github.com/Deep-Identity-Inc/deepidv-chain-node).
Wire-format changes (envelope, STH, manifest, bundle layout)
require coordinated PRs against the Python SDK and the backend's
shared-deps; see the parity fixtures under `test/fixtures/`.

## License

Apache-2.0 © Deep Identity Inc.

The SDK and the chain layer it talks to are part of
[deepidv](https://proof.deepidv.com), a verification engine and
agentic compliance suite operated out of San Francisco.
