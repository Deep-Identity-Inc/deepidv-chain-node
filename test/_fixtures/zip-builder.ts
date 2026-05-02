/**
 * Test helper — build a stored-method ZIP archive in memory.
 *
 * Produces a byte sequence compatible with the `unzipBundle()`
 * reader, using only `node:zlib`'s CRC32. Stored method only —
 * matches what the M05 bundle Lambda emits.
 */

import { createHash, type BinaryLike } from "node:crypto";
import { crc32 } from "node:zlib";

const ZIP_LFH_SIG = 0x04034b50;
const ZIP_CDFH_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;

export function buildStoredZip(
  files: Record<string, Uint8Array>,
): Uint8Array {
  const enc = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const cdChunks: Uint8Array[] = [];
  let offset = 0;
  const entries: Array<{
    name: Uint8Array;
    crc: number;
    size: number;
    lfhOffset: number;
  }> = [];

  for (const [path, bytes] of Object.entries(files)) {
    const nameBytes = enc.encode(path);
    const crc = crc32(bytes as unknown as BinaryLike) >>> 0;
    const size = bytes.byteLength;
    const lfh = new Uint8Array(30 + nameBytes.byteLength);
    const lfhDv = new DataView(lfh.buffer);
    lfhDv.setUint32(0, ZIP_LFH_SIG, true);
    lfhDv.setUint16(4, 20, true); // version needed
    lfhDv.setUint16(6, 0, true); // flags
    lfhDv.setUint16(8, 0, true); // method = STORED
    lfhDv.setUint16(10, 0, true); // mod time
    lfhDv.setUint16(12, 0, true); // mod date
    lfhDv.setUint32(14, crc, true);
    lfhDv.setUint32(18, size, true);
    lfhDv.setUint32(22, size, true);
    lfhDv.setUint16(26, nameBytes.byteLength, true);
    lfhDv.setUint16(28, 0, true);
    lfh.set(nameBytes, 30);
    localChunks.push(lfh);
    localChunks.push(bytes);

    entries.push({
      name: nameBytes,
      crc,
      size,
      lfhOffset: offset,
    });
    offset += lfh.byteLength + size;
  }

  let cdSize = 0;
  for (const e of entries) {
    const cdfh = new Uint8Array(46 + e.name.byteLength);
    const dv = new DataView(cdfh.buffer);
    dv.setUint32(0, ZIP_CDFH_SIG, true);
    dv.setUint16(4, 20, true); // version made by
    dv.setUint16(6, 20, true); // version needed
    dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint16(14, 0, true);
    dv.setUint32(16, e.crc, true);
    dv.setUint32(20, e.size, true);
    dv.setUint32(24, e.size, true);
    dv.setUint16(28, e.name.byteLength, true);
    dv.setUint16(30, 0, true);
    dv.setUint16(32, 0, true);
    dv.setUint16(34, 0, true);
    dv.setUint16(36, 0, true);
    dv.setUint32(38, 0, true);
    dv.setUint32(42, e.lfhOffset, true);
    cdfh.set(e.name, 46);
    cdChunks.push(cdfh);
    cdSize += cdfh.byteLength;
  }

  const cdOffset = offset;
  const eocd = new Uint8Array(22);
  const eocdDv = new DataView(eocd.buffer);
  eocdDv.setUint32(0, ZIP_EOCD_SIG, true);
  eocdDv.setUint16(4, 0, true);
  eocdDv.setUint16(6, 0, true);
  eocdDv.setUint16(8, entries.length, true);
  eocdDv.setUint16(10, entries.length, true);
  eocdDv.setUint32(12, cdSize, true);
  eocdDv.setUint32(16, cdOffset, true);
  eocdDv.setUint16(20, 0, true);

  const total =
    localChunks.reduce((n, c) => n + c.byteLength, 0) +
    cdSize +
    eocd.byteLength;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of localChunks) {
    out.set(c, p);
    p += c.byteLength;
  }
  for (const c of cdChunks) {
    out.set(c, p);
    p += c.byteLength;
  }
  out.set(eocd, p);
  return out;
}

// Quick sanity for the helper itself.
void createHash;
