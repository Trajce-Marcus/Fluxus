// Slice 3 (ATTRIBUTE_TYPES_FILES_SCALARS §10): the pure, node-runnable half of
// the upload core — hashing and EXIF parsing. Thumbnail generation and the
// direct-to-R2 PUT need a browser and are exercised in the e2e pass.

import { describe, expect, it } from 'vitest';
import { sha256Hex, dmsToDecimal, readExif } from '../src/upload';

describe('sha256Hex', () => {
  it('matches the known digest of an empty buffer', async () => {
    const hex = await sha256Hex(new ArrayBuffer(0));
    expect(hex).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('is deterministic hex for bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    expect(await sha256Hex(bytes)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('dmsToDecimal', () => {
  it('north/east stay positive', () => {
    expect(dmsToDecimal([33, 52, 4.2], 'S')).toBeCloseTo(-33.86783, 4);
    expect(dmsToDecimal([151, 12, 30], 'E')).toBeCloseTo(151.20833, 4);
  });
});

describe('readExif', () => {
  it('returns {} for a non-JPEG buffer', () => {
    expect(readExif(new Uint8Array([0, 1, 2, 3]).buffer)).toEqual({});
  });
  it('returns {} for a JPEG with no Exif segment', () => {
    expect(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer)).toEqual({});
  });

  it('parses DateTimeOriginal from a hand-built little-endian Exif segment', () => {
    // Minimal TIFF: IFD0 → Exif SubIFD pointer (0x8769) → DateTimeOriginal
    // (0x9003, ASCII "2026:07:18 14:30:00\0").
    const tiff = new Uint8Array(64);
    const dv = new DataView(tiff.buffer);
    tiff[0] = 0x49; tiff[1] = 0x49;                 // "II" little-endian
    dv.setUint16(2, 0x2a, true);                     // magic 42
    dv.setUint32(4, 8, true);                        // IFD0 at offset 8
    dv.setUint16(8, 1, true);                        // IFD0: 1 entry
    dv.setUint16(10, 0x8769, true);                  //   tag: Exif SubIFD ptr
    dv.setUint16(12, 4, true);                       //   type LONG
    dv.setUint32(14, 1, true);                       //   count 1
    dv.setUint32(18, 26, true);                      //   value: SubIFD at 26
    dv.setUint32(22, 0, true);                       // IFD0 next = none
    dv.setUint16(26, 1, true);                       // SubIFD: 1 entry
    dv.setUint16(28, 0x9003, true);                  //   tag: DateTimeOriginal
    dv.setUint16(30, 2, true);                       //   type ASCII
    dv.setUint32(32, 20, true);                      //   count 20
    dv.setUint32(36, 44, true);                      //   value: string at 44
    dv.setUint32(40, 0, true);                       // SubIFD next = none
    const s = '2026:07:18 14:30:00\0';
    for (let i = 0; i < s.length; i++) tiff[44 + i] = s.charCodeAt(i);

    const header = [0xff, 0xd8, 0xff, 0xe1, 0x00, 0x48, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
    const full = new Uint8Array(header.length + tiff.length);
    full.set(header, 0);
    full.set(tiff, header.length);

    expect(readExif(full.buffer).taken_at).toBe('2026-07-18T14:30:00');
  });
});
