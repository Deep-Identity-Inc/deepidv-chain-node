/**
 * Minimal stored-method ZIP reader.
 *
 * `.dpiv-bundle` files are produced by the M05 bundle Lambda using
 * the stored (uncompressed) method per ARCHITECTURE.md §8 D.4 — the
 * payloads are already entropy-dense (sigs, hex digests, signed
 * timestamps) and storing uncompressed lets verifiers operate
 * without a deflate implementation. That choice keeps this SDK at
 * zero runtime deps.
 *
 * This reader supports STORED (method=0) only. If the registry ever
 * starts emitting DEFLATE bundles, this function throws a clear
 * "unsupported compression method" error rather than silently
 * misverifying. The intent is documented in the bundle builder, the
 * verify.sh script, and ARCHITECTURE.md — coordinated change only.
 *
 * No symlink, no zip-slip, no UTF-8 surprises. Path entries are
 * checked against backslashes and `..` segments before being added
 * to the output map.
 */

const ZIP_LFH_SIG = 0x04034b50;
const ZIP_CDFH_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;

const METHOD_STORED = 0;

export interface UnzipResult {
  /** Bundle-relative path → file bytes. POSIX forward slashes only. */
  files: Record<string, Uint8Array>;
}

/**
 * Parse a stored-method ZIP buffer into a flat path → bytes map.
 *
 * Reads the End Of Central Directory record at the tail, walks the
 * central directory forward, and extracts each entry from its local
 * file header position. Refuses entries with backslashes, leading
 * slashes, or `..` segments.
 */
export function unzipBundle(input: ArrayBuffer | Uint8Array): UnzipResult {
  const buf = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Locate EOCD (search backward up to ~64 KB to skip a minimal
  // ZIP64 / no-comment archive — the bundle's comment is empty).
  const maxBack = Math.min(buf.byteLength, 65557);
  let eocdOffset = -1;
  for (let i = buf.byteLength - 22; i >= buf.byteLength - maxBack; i--) {
    if (i < 0) break;
    if (dv.getUint32(i, true) === ZIP_EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("unzip: not a ZIP archive (no EOCD signature)");
  }

  const totalEntries = dv.getUint16(eocdOffset + 10, true);
  const cdSize = dv.getUint32(eocdOffset + 12, true);
  const cdOffset = dv.getUint32(eocdOffset + 16, true);
  if (cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error("unzip: ZIP64 archives are not supported");
  }

  const files: Record<string, Uint8Array> = {};
  let cur = cdOffset;
  const decoder = new TextDecoder("utf-8", { fatal: true });

  for (let i = 0; i < totalEntries; i++) {
    if (dv.getUint32(cur, true) !== ZIP_CDFH_SIG) {
      throw new Error("unzip: bad central directory file header");
    }
    const method = dv.getUint16(cur + 10, true);
    const compressedSize = dv.getUint32(cur + 20, true);
    const uncompressedSize = dv.getUint32(cur + 24, true);
    const nameLen = dv.getUint16(cur + 28, true);
    const extraLen = dv.getUint16(cur + 30, true);
    const commentLen = dv.getUint16(cur + 32, true);
    const lfhOffset = dv.getUint32(cur + 42, true);

    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error("unzip: ZIP64 entries are not supported");
    }
    if (lfhOffset === 0xffffffff) {
      throw new Error("unzip: ZIP64 entries are not supported");
    }

    const nameBytes = buf.subarray(cur + 46, cur + 46 + nameLen);
    let name: string;
    try {
      name = decoder.decode(nameBytes);
    } catch {
      throw new Error("unzip: filename is not valid UTF-8");
    }

    if (name.length === 0) {
      throw new Error("unzip: empty filename in central directory");
    }
    if (name.includes("\\")) {
      throw new Error(`unzip: backslash in filename: ${JSON.stringify(name)}`);
    }
    if (name.startsWith("/")) {
      throw new Error(`unzip: absolute path filename: ${JSON.stringify(name)}`);
    }
    for (const segment of name.split("/")) {
      if (segment === "..") {
        throw new Error(
          `unzip: parent-directory traversal in filename: ${JSON.stringify(name)}`,
        );
      }
    }

    cur += 46 + nameLen + extraLen + commentLen;

    // Skip directory entries (trailing /).
    if (name.endsWith("/")) continue;

    if (method !== METHOD_STORED) {
      throw new Error(
        `unzip: unsupported compression method ${method} for ${JSON.stringify(name)} ` +
          `(only STORED is supported; .dpiv-bundle uses STORED per ARCHITECTURE.md §8 D.4)`,
      );
    }

    if (dv.getUint32(lfhOffset, true) !== ZIP_LFH_SIG) {
      throw new Error("unzip: bad local file header");
    }
    const lfhNameLen = dv.getUint16(lfhOffset + 26, true);
    const lfhExtraLen = dv.getUint16(lfhOffset + 28, true);
    const dataStart = lfhOffset + 30 + lfhNameLen + lfhExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buf.byteLength) {
      throw new Error(`unzip: entry "${name}" extends past end of archive`);
    }

    files[name] = buf.subarray(dataStart, dataEnd);
  }

  return { files };
}
