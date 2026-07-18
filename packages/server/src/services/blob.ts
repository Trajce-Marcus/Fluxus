// The blob-store seam (ATTRIBUTE_TYPES_FILES_SCALARS §6): the ONLY module that
// touches the S3 client. Bytes never transit our server — the browser PUTs
// directly to the bucket via short-TTL presigned URLs, and display fetches
// presigned GETs on demand. We speak the genuine S3 API (Cloudflare R2 today,
// byte-portable to AWS S3 / Backblaze B2), so the provider never leaks past
// this file.
//
// Provisioning is deferred — with no FLUXUS_R2_* env the store reports
// `configured: false` and the files router answers a clear "not configured"
// error, so the rest of the platform builds and runs against the seam.

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Platform per-file byte ceiling (§7 #2) — regardless of a type_config typo. */
export const PLATFORM_MAX_BYTES = 20 * 1024 * 1024;
/**
 * Environment storage fuse (§7 #3): once the ledger's SUM(size) passes this,
 * all presigns are refused (uploads fail with "storage limit reached" instead
 * of a bill arriving). 8 GB — under R2's permanent 10 GB free tier.
 */
export const ENV_FUSE_BYTES = 8 * 1024 * 1024 * 1024;

/** Short TTL for presigned URLs (seconds). */
const UPLOAD_TTL = 5 * 60;
const GET_TTL = 5 * 60;

export interface PresignedUpload {
  /** The bucket key the object will live at. */
  storageKey: string;
  /** Presigned PUT URL, signed for the declared content type. */
  uploadUrl: string;
}

export interface BlobStore {
  /** False when FLUXUS_R2_* is unset — the seam is present, the bucket is not. */
  readonly configured: boolean;
  /** Presign a direct PUT for `key`, signed to the declared content type. */
  presignUpload(key: string, contentType: string): Promise<string>;
  /** Presign a direct GET for `key` (browser-cacheable, short TTL). */
  presignGet(key: string): Promise<string>;
}

/** Strip a filename to a safe key segment; keep the extension. */
export function sanitiseName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_');
  return cleaned.replace(/^[._]+/, '') || 'file';
}

/**
 * A fresh object key: `<yyyy>/<mm>/<uuid>/<sanitised-name>`, thumbnail at
 * `…/<uuid>/thumb.jpg` (§6). The date prefix keeps listings browsable; the
 * uuid folder groups an object with its thumbnail for folder-level GC.
 */
export function makeStorageKey(name: string, now: Date = new Date()): { storageKey: string; thumbKey: string } {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const uuid = globalThis.crypto.randomUUID();
  const base = `${yyyy}/${mm}/${uuid}`;
  return { storageKey: `${base}/${sanitiseName(name)}`, thumbKey: `${base}/thumb.jpg` };
}

interface R2Env {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function readEnv(): R2Env | null {
  const accountId = process.env.FLUXUS_R2_ACCOUNT_ID;
  const accessKeyId = process.env.FLUXUS_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.FLUXUS_R2_SECRET_ACCESS_KEY;
  const bucket = process.env.FLUXUS_R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

/**
 * Build the blob store from FLUXUS_R2_* env. When any var is missing the store
 * is returned unconfigured (presign throws) so callers can construct context
 * unconditionally and the router surfaces a clean error.
 */
export function createBlobStore(): BlobStore {
  const env = readEnv();
  if (!env) {
    const notConfigured = () => {
      throw new Error('Blob storage is not configured (set FLUXUS_R2_* env vars)');
    };
    return { configured: false, presignUpload: notConfigured, presignGet: notConfigured };
  }
  // R2's S3 endpoint; region 'auto' (R2 ignores it but the SDK requires one).
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey },
  });
  return {
    configured: true,
    presignUpload: (key, contentType) =>
      getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: env.bucket, Key: key, ContentType: contentType }),
        { expiresIn: UPLOAD_TTL, signableHeaders: new Set(['content-type']) },
      ),
    presignGet: (key) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: env.bucket, Key: key }), { expiresIn: GET_TTL }),
  };
}
