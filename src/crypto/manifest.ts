/**
 * `MANIFEST.txt` serializer + parser.
 *
 * Format (per ARCHITECTURE.md §8 D.9):
 *
 *     <64 hex chars><two spaces><path><LF>
 *
 * Drop-in compatible with `sha256sum -c MANIFEST.txt` on Linux and
 * `shasum -a 256 -c MANIFEST.txt` on macOS. Lines are sorted
 * lexically by `path` so two builds of the same bundle produce
 * byte-identical MANIFEST contents.
 *
 * Hex digests are 64 lowercase characters (256 bits). No `0x`
 * prefix. Two literal ASCII spaces separate digest from path —
 * matching GNU coreutils output exactly. Trailing newline after
 * every entry.
 *
 * Paths are bundle-relative POSIX-style with forward slashes
 * (`timestamps/digicert.tsr`, NOT `timestamps\\digicert.tsr`). The
 * bundle's zip already enforces forward slashes; manifest paths
 * inherit.
 *
 * Functionally equivalent to
 * `shared-deps/chain/bundle/manifest.ts`. Reimplemented here for
 * dependency-zero parity reasons (see `./jcs.ts` rationale).
 */

import type { ManifestEntry } from "../types/index.js";

const SHA256_HEX_LEN = 64;
const SEPARATOR = "  "; // exactly two spaces — sha256sum convention

/**
 * Serialize a list of manifest entries to `MANIFEST.txt` text.
 *
 * Sorts by `path` (lexical) before emitting so output is
 * deterministic — re-running on the same input always produces the
 * same bytes. Sorting is non-mutating; the input array is not
 * modified.
 *
 * Throws if any `sha256` field is not 64 lowercase hex characters,
 * or if any `path` contains a literal newline. Callers should
 * validate inputs upstream; this is defense-in-depth.
 */
export function serializeManifest(entries: readonly ManifestEntry[]): string {
  const sorted = [...entries].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const lines: string[] = [];
  for (const e of sorted) {
    if (!isValidSha256Hex(e.sha256)) {
      throw new Error(
        `manifest: invalid sha256 for "${e.path}": expected 64 lowercase hex chars`,
      );
    }
    if (e.path.includes("\n") || e.path.includes("\r")) {
      throw new Error(
        `manifest: path contains newline: ${JSON.stringify(e.path)}`,
      );
    }
    lines.push(e.sha256 + SEPARATOR + e.path + "\n");
  }
  return lines.join("");
}

/**
 * Parse `MANIFEST.txt` text back into entries.
 *
 * Strict — rejects:
 *   - lines that don't match the `<64 hex>  <path>` shape
 *   - duplicate paths (the bundle builder never produces duplicates;
 *     a duplicate at parse time means the manifest was tampered
 *     with or hand-edited)
 *   - paths beginning with whitespace (defends against an attacker
 *     padding the separator with extra spaces)
 *
 * Tolerates a trailing empty line (CRLF or LF). Does NOT tolerate
 * arbitrary whitespace around fields — the format is rigid by
 * design so malicious manifests can't sneak in lookalike paths via
 * normalization.
 *
 * Returns entries in their on-disk order. Callers that need a
 * canonical order should sort by `path`; `serializeManifest`
 * round-trips a sort.
 */
export function parseManifest(text: string): ManifestEntry[] {
  const out: ManifestEntry[] = [];
  const seen = new Set<string>();
  const lines = text
    .split("\n")
    .map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.length === 0) {
      throw new Error(`manifest: empty line at line ${i + 1}`);
    }
    if (line.length < SHA256_HEX_LEN + SEPARATOR.length + 1) {
      throw new Error(`manifest: short line at line ${i + 1}`);
    }
    const sha256 = line.slice(0, SHA256_HEX_LEN);
    const sep = line.slice(SHA256_HEX_LEN, SHA256_HEX_LEN + SEPARATOR.length);
    const path = line.slice(SHA256_HEX_LEN + SEPARATOR.length);
    if (!isValidSha256Hex(sha256)) {
      throw new Error(`manifest: invalid sha256 at line ${i + 1}`);
    }
    if (sep !== SEPARATOR) {
      throw new Error(`manifest: missing two-space separator at line ${i + 1}`);
    }
    if (path.length === 0) {
      throw new Error(`manifest: empty path at line ${i + 1}`);
    }
    if (path[0] === " " || path[0] === "\t") {
      throw new Error(`manifest: path begins with whitespace at line ${i + 1}`);
    }
    if (seen.has(path)) {
      throw new Error(`manifest: duplicate path at line ${i + 1}: ${path}`);
    }
    seen.add(path);
    out.push({ path, sha256 });
  }
  return out;
}

/**
 * True iff `s` is exactly 64 lowercase hex characters. The format
 * is deliberately strict — uppercase or short digests are rejected
 * so verifiers can rely on byte-equality of MANIFEST contents
 * across platforms.
 */
export function isValidSha256Hex(s: string): boolean {
  if (s.length !== SHA256_HEX_LEN) return false;
  for (let i = 0; i < SHA256_HEX_LEN; i++) {
    const c = s.charCodeAt(i);
    const isDigit = c >= 0x30 && c <= 0x39;
    const isLowerHex = c >= 0x61 && c <= 0x66;
    if (!isDigit && !isLowerHex) return false;
  }
  return true;
}
