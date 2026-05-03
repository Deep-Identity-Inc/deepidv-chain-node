# M07 — Luka verification handoff

> **Module 07 — `@deepidv/chain` (npm SDK).**
> Branch: `chain/07-sdk-npm` (cut from `main`).
> Author: Claude Opus 4.7. Date: 2026-05-02.
> Predecessor: M02 (envelope format + API contract). Confirmed via
> shared-deps v2.4.0 source of truth.

This handoff exists so a second pair of eyes can verify the M07
build before publishing to npm. The publish ceremony (npm `1.0.0`,
git tag `v1.0.0`) is gated on Luka signing off Sections 1-5 and
Shawn-Marc resolving Section 6.

## 1. What landed

| Area | Files |
| ---- | ----- |
| Scaffold | `package.json`, `tsconfig.json`, `tsup.config.ts`, `eslint.config.mjs`, `.prettierrc.json`, `.gitignore`, `.npmrc`, `.npmignore` |
| Wire types | `src/types/{envelope,sth,bundle,api,index}.ts` |
| Crypto | `src/crypto/{jcs,hash,manifest,merkle,index}.ts` |
| API client | `src/client/{index,sse}.ts` |
| Errors | `src/errors/index.ts` |
| Verify | `src/verify/{index,unzip}.ts` |
| Tests | `test/{jcs,envelope-parity,sth-parity,manifest,merkle,client,sse,verify}.spec.ts` + `test/_fixtures/{build-bundle,zip-builder}.ts` + `test/fixtures/parity-{envelope,sth,manifest}.json` |
| Docs | `README.md`, `CHANGELOG.md`, this file, `claude-code/discovery/M07.md` |
| Examples | `examples/{verify-bundle,registry-search,sse-stream}.ts` |
| CI | `.github/workflows/{ci,publish}.yml` |

Total: 11 commits on `chain/07-sdk-npm`. 67 tests passing.
Zero runtime dependencies.

## 2. How to verify

Run on a clean clone (do NOT trust a stale `node_modules`):

```bash
git clone -b chain/07-sdk-npm https://github.com/Deep-Identity-Inc/deepidv-chain-node.git verify-m07
cd verify-m07
nvm use 20  # or 22
npm ci

# Gate 1 — typecheck
npm run typecheck

# Gate 2 — lint + format
npm run lint
npm run format:check

# Gate 3 — tests (parity + crypto + client + sse + verify)
npm test
# Expect: 67 passing, 0 failing

# Gate 4 — dual ESM + CJS build
npm run build
# Expect: dist/{index,client/index,types/index,crypto/index,verify/index}
#         each in .mjs, .cjs, .d.ts, .d.cts variants

# Gate 5 — pack inspection
npm pack --dry-run
# Expect: ~25-40 files, all under dist/, plus README, CHANGELOG, LICENSE.
#         No src/, no test/, no examples/, no .github/.

# Gate 6 — brand check
grep -REn 'Arc|UAIIP|getai\.id|deeprisk|DeepIDV|Deep IDV|Deep ID V|deepsign|Dallas|Toronto' \
  src README.md CHANGELOG.md examples docs
# Expect: no matches.

# Gate 7 — runs against a real staging attestation
# Pick any attestation id from `staging-api.deepidv.com/v1/registry`
# (or substitute your favorite from M05's sandbox mints):
npx tsx examples/verify-bundle.ts <attestation_id>
# Expect: ok=true with tsa_tokens=skipped. If staging /v1/bundle
# isn't yet returning bundles for the picked id, this gate is
# blocked-on-M05 — note in Section 5 and re-run when M05 lands.

# Gate 8 — staging registry pagination + SSE
npx tsx examples/registry-search.ts --pages 2
npx tsx examples/sse-stream.ts --max 3
# Expect: rows print; SSE emits at least one event within 30 s of
# subscribing. If /v1/stream is still 403 (M06a backlog), SSE will
# surface backoff retries — that's the documented degraded mode,
# not a regression in M07.
```

## 3. What's deliberately not done

These are correct-by-design omissions. Don't add them on a "while
you're in there" pass — they're gated by other modules or by
explicit policy.

1. **TSA token verification.** `verifyBundle()` performs 5 of 6
   ARCHITECTURE.md §8 D.5 checks. Step 3 is reported as the
   literal string `"skipped"`. Pulling a full RFC 3161 verifier
   into a zero-dependency SDK would add ~200 KB of transitive
   deps. The bundle's own `verify.sh` is the canonical TSA
   verifier (uses `openssl ts -verify` against the pinned
   DigiCert and Sectigo CA chains).
2. **On-chain RPC verification.** Step 6 cross-checks the
   `onchain.json` structural fields against `sth.json` and
   exposes the on-chain reference. It does NOT call `eth_call` /
   `eth_getTransactionByHash`. Live tx confirmation is a
   `verify.sh` concern (and even there is informational per D.7).
3. **No mint / revoke methods.** This SDK is read-only against
   the public registry surface. Mint and revoke are
   tenant-authenticated operations that don't belong on the
   public SDK in v1.
4. **No `RSK | AML | AGR | ACT` record types.** v1 ships
   `IDV` active and `BIO | DOC | ADDR` reserved. Phase 2 widens
   the union; that's a semver-minor bump in the SDK.
5. **No witness / consistency-check daemon.** `verifyConsistency`
   is exported as a primitive from `@deepidv/chain/crypto`, but
   the daemon that polls successive STHs and pages an operator
   on mismatch is part of M10 (Governance Console), not M07.

## 4. Privacy + secrets review

- The SDK never sends authentication headers. The public
  registry is unauthenticated by design.
- `verifyBundle()` recomputes salt-bearing label commits but
  does NOT log the salts. Revealed salts only travel through
  `LabelsJson::RevealedLabel` to the caller; surfacing them in
  a UI is the caller's responsibility (and obligation).
- No NPM_TOKEN, AWS keys, or KMS material entered the build
  session. The publish workflow consumes `NPM_TOKEN` from a
  GitHub Environment secret (not a repo secret) so it can be
  scoped behind required reviewers.
- `.npmrc` uses `${NPM_TOKEN}` substitution; nothing
  privileged is committed.
- Brand check is enforced both in CI (`grep -REn` against the
  source tree) and in the publish workflow (against the packed
  tarball). A regression in either fails the workflow before
  publish.

## 5. Status of the staging integration paths

Tested against `https://staging-api.deepidv.com` on
2026-05-02 (today). Captured here for Luka so that the
"runs in CI but not against staging" failure mode is visible.

| Endpoint | Status | Notes |
| -------- | ------ | ----- |
| `GET /v1/log` | unverified | Will be probed by the integration job in `ci.yml`. Warning-only at the SDK level — endpoint readiness owned by M06a. |
| `GET /v1/registry` | unverified | Same as above. |
| `GET /v1/attestation/:id` | unverified | Verify by hand against any sandbox-mint id from M05. |
| `GET /v1/bundle/:id` | unverified | Blocks the verify-bundle example end-to-end run. |
| `GET /v1/stream` | unverified | M06a backlog — example will surface backoff retries until it lands. |
| `GET /governance` | not-tested | Should require auth (401/403); SDK does NOT touch this surface. |

Each row above will be filled in by Luka during Gate 7-8 above.
The CI integration job runs the same probes nightly, treating any
non-2xx as a warning rather than a failure (intentional — endpoint
readiness is owned by other modules).

## 6. Open decisions for Luka / Shawn-Marc

These are judgment calls I made mid-flight per the prompt. None
are blocking the build, but each warrants a sign-off before the
v1.0.0 publish.

### 6.1 Build tool — tsup (chose) vs unbuild

- Picked tsup because shared-deps already uses it. Matching the
  existing convention saves a maintenance dimension and lets a
  contributor moving between repos read one config.
- Tradeoff: tsup is built on esbuild + rollup-plugin-dts, which
  emits some hashed shared chunks (`dist/api-CX3DJclJ.d.ts`).
  These are private build artifacts; the public surface is
  what's named in `exports`. Visually noisy in the dist tree
  but harmless.
- **Decision needed:** sign-off, or switch to unbuild (~30 min
  to migrate, no functional difference).

### 6.2 Test runner — `node --test` (chose) vs vitest

- Picked `node --test` driven by `tsx` because it matches
  shared-deps' parity-test style exactly and ships zero extra
  dependencies. The same fixture files and the same assertion
  shape work on both sides of the cross-language parity gate.
- Tradeoff: no built-in mocking helpers, no `vi.mock`. The
  client + SSE specs hand-rolled fakes; they're small and
  readable, but vitest would have been ~30 % less code.
- **Decision needed:** keep node:test, or migrate to vitest in
  a follow-up. If the SDK starts needing complex mocks (e.g.
  full mock backend), revisit.

### 6.3 Staging API URL — prompt vs proof-deepidv

- Prompt says default to `https://staging-api.deepidv.com`.
- `proof-deepidv/src/lib/api/client.ts` defaults to
  `https://staging-api.proof.deepidv.com`.
- I followed the prompt verbatim. Production callers will
  override either way; the default only matters for the
  examples and the integration probe.
- **Decision needed:** confirm the prompt's URL is correct,
  or update the SDK + examples + CI integration job + README
  in one follow-up commit. If they're aliases, this is a
  no-op; if one is canonical the choice matters for the
  integration probe.

### 6.4 Class name — `DeepidvChainClient` (PascalCase)

- The runbook §0.A says brand spelling is lowercase
  `deepidv` in user-facing strings.
- JavaScript class identifiers are conventionally
  PascalCase. I used `DeepidvChainClient` (Pascal of
  "deepidv"). The error classes follow the same pattern:
  `DeepidvApiError`, `DeepidvAuthError`, etc.
- The original M07 spec used `DeepIdvChain` as the
  illustrative class name. Both forms are PascalCase
  derivatives of "deepidv"; neither is the forbidden
  "DeepIDV" (which is the user-facing-string violation).
- **Decision needed:** confirm `DeepidvChainClient` is
  acceptable, or rename to `DeepIdvChainClient` /
  `DeepIDVChainClient` / `Client` (no brand prefix at all).
  Renaming is a 5-min sed before publish.

### 6.5 `engines.node >= 20` (chose) vs `>= 18`

- Picked `>= 20` because:
  - global `fetch` is stable in 18+ but `AbortSignal.timeout`
    is stable only in 17+, `AbortSignal.any` only in 20+;
  - `ReadableStream` async iteration is stable in 20+;
  - Node 18 is in maintenance mode; Node 20 is the current LTS.
- The Python SDK requires Python 3.9+. Cross-language
  consistency would suggest pulling Node back to 18; cleaner
  primitives suggest 20.
- **Decision needed:** confirm 20+, or take the 18+ pin and
  add fallbacks for `AbortSignal.any` (already done — see
  `combineSignals` in `src/client/index.ts`) and
  `AbortSignal.timeout` (would need a polyfill).

### 6.6 SSE iterator — hand-rolled vs Node's experimental EventSource

- Picked hand-rolled because Node 20's `EventSource` is still
  flagged behind `--experimental-fetch` in some patch versions
  and skips `Last-Event-ID` semantics. Pulling
  `eventsource@npm` violates the zero-runtime-dep rule.
- Tradeoff: ~200 lines of frame-parsing code that the spec
  test suite covers but a future contributor will need to read.
- **Decision needed:** accept the hand-roll, or wait until
  EventSource is unflagged and migrate.

### 6.7 Examples ship `tsx` execution, not built JS

- Examples are `.ts` files that consumers run via
  `npx tsx examples/verify-bundle.ts`. They `import` from
  `../src/index.js` (the source, not the built dist) so they
  always exercise the latest local code.
- An alternative is to ship pre-built `.mjs` examples that
  import from the published package. That's better for
  external consumers but worse for local development.
- **Decision needed:** keep tsx-driven local examples, or
  add a parallel `examples-built/` set that imports
  `@deepidv/chain` from npm.

## 7. Publish ceremony (STOPs require Shawn-Marc)

When Sections 1-5 are signed off and Section 6 resolved:

```bash
# 1. Tag locally
git checkout main
git merge --no-ff chain/07-sdk-npm   # or rebase per repo convention
git tag -a v1.0.0 -m "@deepidv/chain v1.0.0 — initial GA"
git push origin main --tags

# 2. The publish.yml workflow fires automatically on the tag
#    push. It does, in order:
#      - verifies the tag matches package.json
#      - typecheck + lint + test + build
#      - npm pack and brand-grep the packed tarball
#      - npm publish --access public --provenance
#    Requires NPM_TOKEN secret on the `npm-publish` Environment.

# 3. Confirm the publish landed
npm view @deepidv/chain@1.0.0
# Expect: provenance.signatures present
```

If anything in the publish job fails, the npm publish step never
runs — so a failed publish = nothing on the registry to roll back.
Re-tag after fixing.

## 8. Follow-ups (not blocking M07)

- **M08 parity sweep.** Once the Python SDK lands its parity
  tests against the same fixtures, run both repos' parity
  suites side-by-side and confirm the locked SHA-256 constants
  match. Drift is a hard fail.
- **Witness daemon.** A small CLI that consumes
  `streamAttestations()` and `verifyConsistency()` to monitor
  the log without operator intervention. Belongs to M10, not
  M07.
- **TSA token verifier.** A separate, opt-in package
  (`@deepidv/chain-tsa`) that pulls in the ASN.1 + RFC 3161
  deps for users who want full six-of-six verification without
  shelling out to OpenSSL. Out of scope for v1.
