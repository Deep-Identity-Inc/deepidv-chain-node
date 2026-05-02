/**
 * @deepidv/chain — Node SDK entry point.
 *
 * Public surface for the chain layer at api.proof.deepidv.com.
 * Subpath imports are supported and recommended for tree-shakability:
 *
 *   import { createClient } from "@deepidv/chain/client";
 *   import { verifyBundle } from "@deepidv/chain/verify";
 *   import { jcs, envelopeHash } from "@deepidv/chain/crypto";
 *
 * Or pull everything from the root export.
 *
 * Implementation lands across commits 2–5 of M07. Commit 1 (this
 * file's first form) ships only scaffolding so the build, lint,
 * typecheck, and test pipelines turn over green before any logic
 * lands.
 */

export const SDK_VERSION = "1.0.0";
