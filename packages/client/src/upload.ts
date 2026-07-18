// The upload core (ATTRIBUTE_TYPES_FILES_SCALARS §10): plain browser logic, no
// React — hashing, EXIF extraction, canvas thumbnails, and the direct-to-R2 PUT
// with progress. It lives here (the browser door both hosts stand on) so the
// capture widgets in any host stay pure controlled components that just call an
// injected UploadService. The bytes never transit our server: the browser PUTs
// straight to the bucket using the presigned URL the server hands back.

// ── Descriptor value types (§4) ──────────────────────────────────────────────
// The by-value bag a file/photo attribute stores in place of the bytes.

export interface FileDescriptor {
  storage_key: string;
  name: string;
  mime: string;
  size: number;
  hash: string;
}

export interface PhotoDescriptor extends FileDescriptor {
  width: number;
  height: number;
  thumb_key: string;
  /** EXIF — absent when the photo carries no geotag / timestamp. */
  lat?: number;
  lng?: number;
  taken_at?: string;
}

export type Descriptor = FileDescriptor | PhotoDescriptor;

/** What the server's files.presignUpload returns (thumb fields on photos only). */
export interface Presigned {
  storageKey: string;
  uploadUrl: string;
  thumbKey?: string;
  thumbUploadUrl?: string;
}

/** The metadata the client computes before asking the server to presign. */
export interface PresignRequest {
  attributeKey: string;
  name: string;
  mime: string;
  size: number;
  hash: string;
  width?: number;
  height?: number;
  lat?: number;
  lng?: number;
  taken_at?: string;
}

/** Injected into capture widgets — the whole upload surface they touch. */
export interface UploadService {
  /** Upload one file for `attributeKey`; resolves to its stored descriptor. */
  upload(attributeKey: string, file: File, onProgress?: (fraction: number) => void): Promise<Descriptor>;
  /** A short-TTL presigned GET URL for display/download of a stored object. */
  resolveUrl(storageKey: string): Promise<string>;
}

// ── Hashing ──────────────────────────────────────────────────────────────────

/** SHA-256 of a buffer as lowercase hex (Web Crypto). */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── EXIF (JPEG APP1) ─────────────────────────────────────────────────────────
// A focused reader for exactly the three fields §4 wants — GPS lat/lng and the
// original timestamp — hand-rolled to avoid a dependency. Anything unexpected
// (not a JPEG, no Exif segment, malformed IFD) returns {} — EXIF is best-effort
// and must never break an upload.

export interface Exif {
  lat?: number;
  lng?: number;
  taken_at?: string;
}

/** GPS degrees/minutes/seconds rationals + hemisphere ref → signed decimal. */
export function dmsToDecimal(dms: [number, number, number], ref: string): number {
  const decimal = dms[0] + dms[1] / 60 + dms[2] / 3600;
  return ref === 'S' || ref === 'W' ? -decimal : decimal;
}

export function readExif(buffer: ArrayBuffer): Exif {
  try {
    const view = new DataView(buffer);
    if (view.getUint16(0) !== 0xffd8) return {}; // not a JPEG

    // Walk JPEG markers to the APP1 (Exif) segment.
    let offset = 2;
    let app1 = -1;
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) break;
      const marker = view.getUint8(offset + 1);
      const size = view.getUint16(offset + 2);
      if (marker === 0xe1) { app1 = offset + 4; break; }
      if (marker === 0xda) break; // start of scan — no metadata past here
      offset += 2 + size;
    }
    if (app1 < 0) return {};
    // "Exif\0\0"
    if (view.getUint32(app1) !== 0x45786966 || view.getUint16(app1 + 4) !== 0x0000) return {};

    const tiff = app1 + 6;
    const le = view.getUint16(tiff) === 0x4949; // II = little-endian, MM = big
    const u16 = (o: number) => view.getUint16(o, le);
    const u32 = (o: number) => view.getUint32(o, le);

    const readIfd = (ifdOffset: number): Map<number, { type: number; count: number; valueOffset: number }> => {
      const entries = new Map<number, { type: number; count: number; valueOffset: number }>();
      const count = u16(ifdOffset);
      for (let i = 0; i < count; i++) {
        const entry = ifdOffset + 2 + i * 12;
        entries.set(u16(entry), { type: u16(entry + 2), count: u32(entry + 4), valueOffset: entry + 8 });
      }
      return entries;
    };

    // Rational (type 5) reads from the offset the entry's value points to.
    const rationalAt = (o: number): number => {
      const num = u32(o);
      const den = u32(o + 4);
      return den === 0 ? 0 : num / den;
    };
    const asciiAt = (o: number, count: number): string => {
      let s = '';
      for (let i = 0; i < count; i++) {
        const c = view.getUint8(o + i);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s;
    };

    const ifd0 = readIfd(tiff + u32(tiff + 4));
    const out: Exif = {};

    // DateTimeOriginal (0x9003) lives in the Exif SubIFD (pointer 0x8769);
    // fall back to IFD0 DateTime (0x0132). Format "YYYY:MM:DD HH:MM:SS".
    const parseDate = (raw: string): string | undefined => {
      const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
      return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : undefined;
    };
    const exifPtr = ifd0.get(0x8769);
    if (exifPtr) {
      const subIfd = readIfd(tiff + u32(exifPtr.valueOffset));
      const dto = subIfd.get(0x9003) ?? subIfd.get(0x9004);
      if (dto && dto.type === 2) out.taken_at = parseDate(asciiAt(tiff + u32(dto.valueOffset), dto.count));
    }
    if (!out.taken_at) {
      const dt = ifd0.get(0x0132);
      if (dt && dt.type === 2) out.taken_at = parseDate(asciiAt(tiff + u32(dt.valueOffset), dt.count));
    }

    // GPS IFD (pointer 0x8825): refs (ASCII) + 3-rational lat/lng.
    const gpsPtr = ifd0.get(0x8825);
    if (gpsPtr) {
      const gps = readIfd(tiff + u32(gpsPtr.valueOffset));
      const latRef = gps.get(1);
      const lat = gps.get(2);
      const lngRef = gps.get(3);
      const lng = gps.get(4);
      const triple = (e: { valueOffset: number }) => {
        const base = tiff + u32(e.valueOffset);
        return [rationalAt(base), rationalAt(base + 8), rationalAt(base + 16)] as [number, number, number];
      };
      if (lat && latRef) out.lat = dmsToDecimal(triple(lat), asciiAt(tiff + u32(latRef.valueOffset), latRef.count));
      if (lng && lngRef) out.lng = dmsToDecimal(triple(lng), asciiAt(tiff + u32(lngRef.valueOffset), lngRef.count));
    }
    return out;
  } catch {
    return {}; // best-effort — a malformed segment never blocks the upload
  }
}

// ── Thumbnails (canvas) ──────────────────────────────────────────────────────

const THUMB_MAX_EDGE = 320;

/** Full image dimensions + a JPEG thumbnail (~320px long edge) via canvas. */
async function makeThumbnail(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(width, height));
  const tw = Math.max(1, Math.round(width * scale));
  const th = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(bitmap, 0, 0, tw, th);
  bitmap.close?.();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('thumbnail generation failed'))), 'image/jpeg', 0.8),
  );
  return { blob, width, height };
}

// ── Direct PUT with progress ─────────────────────────────────────────────────

/** PUT a body to a presigned URL, reporting upload progress (XHR — fetch can't). */
function putWithProgress(url: string, body: Blob, contentType: string, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('upload network error'));
    xhr.send(body);
  });
}

// ── Orchestration ────────────────────────────────────────────────────────────

/**
 * Hash → (image: EXIF + thumbnail) → presign → PUT full (+ thumb) → descriptor.
 * `presign` is injected so this stays transport-agnostic (FluxusClient binds it
 * to its tRPC client + scope). Progress reflects the full-image PUT, the heavy
 * part; the thumbnail PUT is small and untracked.
 */
export async function runUpload(
  attributeKey: string,
  file: File,
  presign: (req: PresignRequest) => Promise<Presigned>,
  onProgress?: (fraction: number) => void,
): Promise<Descriptor> {
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  const isImage = file.type.startsWith('image/');

  let thumb: { blob: Blob; width: number; height: number } | null = null;
  let exif: Exif = {};
  if (isImage) {
    exif = readExif(buffer);
    thumb = await makeThumbnail(file);
  }

  const presigned = await presign({
    attributeKey,
    name: file.name,
    mime: file.type,
    size: file.size,
    hash,
    ...(thumb ? { width: thumb.width, height: thumb.height } : {}),
    ...exif,
  });

  await putWithProgress(presigned.uploadUrl, file, file.type || 'application/octet-stream', onProgress);
  if (isImage && thumb && presigned.thumbUploadUrl) {
    await putWithProgress(presigned.thumbUploadUrl, thumb.blob, 'image/jpeg');
  }

  const base: FileDescriptor = { storage_key: presigned.storageKey, name: file.name, mime: file.type, size: file.size, hash };
  if (isImage && thumb && presigned.thumbKey) {
    return { ...base, width: thumb.width, height: thumb.height, thumb_key: presigned.thumbKey, ...exif };
  }
  return base;
}
