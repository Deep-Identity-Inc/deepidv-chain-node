# M07 — `@deepidv/chain` (npm SDK)

> Module 07 of the chain-layer build. Replaces the `0.0.1`
> placeholder on npm with a functional `1.0.0` SDK: typed access to
> the public registry API at `api.proof.deepidv.com`, plus partial
> offline `.dpiv-bundle` verification (5 of 6 ARCHITECTURE.md §8 D.5
> checks; TSA deliberately skipped).
>
> Predecessor: M02 (envelope format + API contract).
> Branch: `chain/07-sdk-npm` cut from `main`.
> Confirmed against `shared-deps@2.4.0`.

## Discovery summary

The repo at branch-cut held only `LICENSE`, a one-line `README.md`,
a placeholder `index.js` (`module.exports = {}`), and a 0.0.1
`package.json`. Sibling repos consulted:

- `deepidv-shared-deps@2.4.0` — primary source of truth for envelope,
  STH, manifest, and bundle-verify shapes
- `proof-deepidv` (M06b reference) — confirmed live API contract
  against staging
- `deepidv-chain-python` (M08 sibling) — same placeholder shape

Three parity fixtures copied verbatim from shared-deps:

- `parity-envelope.json` — locked SHA-256 `03507fb35a…ba26`
- `parity-sth.json` — locked SHA-256 `2c1e1d7e38…a7e7`
- `parity-manifest.json` — locked text SHA-256 `fe6352dc30…2fbd`

Full discovery doc: `claude-code/discovery/M07.md`.

## What landed

Ten commits, scoped tightly per concern:

1. `feat(chain): scaffold @deepidv/chain SDK [M07]`
2. `feat(chain): core wire types — envelope, STH, bundle, API [M07]`
3. `feat(chain): crypto primitives + cross-language parity [M07]`
4. `feat(chain): API client + typed errors + SSE iterator [M07]`
5. `feat(chain): partial offline bundle verification [M07]`
6. `docs(chain): README — install, quickstart, verification scope [M07]`
7. `docs(chain): CHANGELOG — initial 1.0.0 entry [M07]`
8. `ci(chain): GitHub Actions — test matrix + provenance publish [M07]`
9. `docs(chain): runnable examples (verify, registry, sse) [M07]`
10. `docs(chain): Luka verification handoff M07 [M07]`

(Plus this PR body itself as the eleventh commit so the branch is
self-describing.)

## Files added

```
package.json                             real SDK metadata, dual ESM+CJS exports
tsconfig.json                            ES2022, NodeNext, every strict flag on
tsup.config.ts                           dual-build config
eslint.config.mjs / .prettierrc.json     flat eslint v9, prettier
.gitignore / .npmrc / .npmignore         dist-only npm pack, NPM_TOKEN substitution

src/index.ts                             root barrel — re-exports everything
src/types/                               EnvelopeV1, STH, MerkleProofJson, OnchainProofJson,
                                         LabelsJson, ManifestEntry, RegistryRow,
                                         AttestationDetail, SegmentDetail, IssuerDetail,
                                         StreamEvent (open union), 30+ types total
src/errors/index.ts                      DeepidvApiError + 5 typed subclasses,
                                         statusToErrorClass mapper
src/crypto/                              jcs (RFC 8785), sha256/Hex, envelopeHash,
                                         sthHash, serializeManifest/parseManifest,
                                         leafHash/nodeHash/verifyInclusion/Consistency
src/client/                              DeepidvChainClient + createClient, hand-rolled
                                         SSE AsyncIterable with backoff + Last-Event-ID
src/verify/                              verifyBundle (5 of 6, TSA "skipped"), stored-
                                         method ZIP reader with zip-slip defenses

test/                                    67 tests across jcs, parity (envelope/sth/
                                         manifest), merkle, client, sse, verify; +
                                         _fixtures/build-bundle.ts and zip-builder.ts
                                         to construct verifiable bundles in memory

examples/verify-bundle.ts                download + verify by attestation id
examples/registry-search.ts              paginated registry search with filters
examples/sse-stream.ts                   live attestation SSE subscription

.github/workflows/ci.yml                 typecheck + lint + format + test (Node 20, 22)
                                         + build + brand-check + staging probes
.github/workflows/publish.yml            tag-triggered, OIDC provenance, brand-checks
                                         the packed tarball before npm publish

README.md                                public-facing docs (install, quickstart,
                                         API table, verification-scope call-out, privacy)
CHANGELOG.md                             initial 1.0.0 entry
docs/handoffs/M07-luka-verification.md   verification handoff (sections 1-5) +
                                         seven judgment calls in section 6
claude-code/discovery/M07.md             discovery doc
claude-code/handoff/M07-PR-body.md       this file
```

47 files changed, 8 184 insertions, 2 deletions.

## Files NOT modified

- `LICENSE` (already Apache-2.0 from the placeholder release).
- Anything under sibling repos. No edits to `deepidv-shared-deps`,
  `deepidv-chain-python`, `proof-deepidv`, or `deepidv-backend-cdk`.
- No deletions of any kind beyond the placeholder `index.js` and
  `package.json` (which were untracked at branch cut and replaced
  by the real scaffold in commit 1).

## Test coverage delta

- Branch cut: 0 tests (placeholder package).
- This PR: **67 tests passing**, 0 failing, 0 skipped, 0 todo.
  Runs in ~250 ms.
- Cross-language parity assertions are the load-bearing tests:
  any drift in JCS, manifest format, or hash preimage fails
  loudly with a message that names the locked SHA-256 and tells
  the contributor to update shared-deps + the Python SDK in the
  same PR cycle.

## Impact on production

**Zero impact.** The SDK is a new client-side npm package;
publishing `1.0.0` does not affect any deployed deepidv service:

- No new Lambda, no new DynamoDB table, no IAM change, no CDK
  diff. `cdk diff ChainStack` against any environment is unchanged
  by this PR.
- The SDK is read-only against the existing public registry
  surface at `api.proof.deepidv.com/v1/*`. It hits no
  authenticated route, no governance route, no mint route.
- The placeholder `0.0.1` on npm has zero downloads and only
  exists to reserve the `@deepidv/chain` name. Consumers
  installing `@deepidv/chain` for the first time will receive
  `1.0.0` automatically; consumers pinned to `0.0.1` continue to
  receive an empty module until they bump.
- `FEATURE_CHAIN` flag state (off in dev/staging, off in prod
  per runbook §0.B) is unaffected — the SDK is a client, not a
  service.

## Verification gates the reviewer should run

Per `docs/handoffs/M07-luka-verification.md`:

```bash
npm ci
npm run typecheck      # gate 1
npm run lint           # gate 2
npm run format:check
npm test               # gate 3 — expect 67 passing
npm run build          # gate 4 — dual ESM+CJS dist
npm pack --dry-run     # gate 5 — only dist + 3 docs files
grep -REn '<forbidden>' src README.md CHANGELOG.md examples  # gate 6
npx tsx examples/verify-bundle.ts <attestation_id>           # gate 7
npx tsx examples/registry-search.ts --pages 2                # gate 8
npx tsx examples/sse-stream.ts --max 3                       # gate 8
```

Gates 7-8 require staging endpoints to be online. Status table in
the handoff §5 is the place to record those results.

## STOPs requiring Shawn-Marc

1. **Resolve Section 6 of the handoff** (seven judgment calls;
   none blocking, all worth a sign-off).
2. **Tag the publish.** When Sections 1-5 are signed off:
   - `git tag -a v1.0.0 -m "@deepidv/chain v1.0.0 — initial GA"`
   - `git push origin main --tags`
   - `publish.yml` fires automatically. Requires `NPM_TOKEN`
     secret on the `npm-publish` GitHub Environment.
3. **Confirm the npm provenance landed** after publish:
   `npm view @deepidv/chain@1.0.0` should show
   `provenance.signatures` populated.

No other STOPs. The work is locally committed on
`chain/07-sdk-npm`, ready for review and merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
