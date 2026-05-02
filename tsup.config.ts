import { defineConfig } from "tsup";

/**
 * Dual ESM + CJS build with declaration files. Each public subpath
 * (`./types`, `./crypto`, `./verify`, `./client`) gets its own entry
 * so consumers can deep-import for tree-shakability — pulling just
 * `verify` into a server-rendered Next.js route should not pull the
 * SSE client.
 *
 * Externals: nothing. The SDK has zero runtime dependencies — `node:*`
 * imports are resolved at runtime by the consuming Node process.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "types/index": "src/types/index.ts",
    "crypto/index": "src/crypto/index.ts",
    "verify/index": "src/verify/index.ts",
    "client/index": "src/client/index.ts",
  },
  format: ["esm", "cjs"],
  outExtension: ({ format }) => ({
    js: format === "esm" ? ".mjs" : ".cjs",
  }),
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: "node20",
  platform: "node",
  treeshake: true,
});
