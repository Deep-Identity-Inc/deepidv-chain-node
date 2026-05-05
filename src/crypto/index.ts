/**
 * `@deepidv/chain/crypto` — pure crypto primitives.
 *
 * All functions are side-effect-free, dependency-free, and produce
 * byte-identical output with the Python SDK and the backend's
 * shared-deps. Cross-language parity is locked down by the fixture
 * tests in `test/`.
 */

export { jcs } from "./jcs.js";
export { sha256, sha256Hex, envelopeHash, sthHash } from "./hash.js";
export {
  serializeManifest,
  parseManifest,
  isValidSha256Hex,
} from "./manifest.js";
export {
  leafHash,
  nodeHash,
  verifyInclusion,
  verifyConsistency,
  hex,
  unhex,
} from "./merkle.js";
