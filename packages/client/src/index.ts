// @fluxus/client — how a browser host talks to @fluxus/server (backend
// stage 2). One connect call fetches the scope's config + record partition
// (+ page definitions) into the engine's MemoryAdapter, so every UI read and FluxScript expression
// keeps evaluating synchronously against a local snapshot; every mutation is
// an `activities.run` round trip followed by a partition re-fetch. The
// adapter identity never changes — hosts wire their engine and subscriptions
// to it once and refresh flows through Store.subscribe.

import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { MemoryAdapter } from '@fluxus/engine';
import type { ConfigRaw, RecordInstance, RunActivityResult } from '@fluxus/engine';
import type { AppRouter } from '@fluxus/server';
import { runUpload, type Descriptor, type PresignRequest, type Presigned, type UploadService } from './upload';

export type {
  Descriptor,
  FileDescriptor,
  PhotoDescriptor,
  PresignRequest,
  Presigned,
  UploadService,
  Exif,
} from './upload';
export { sha256Hex, readExif, dmsToDecimal, runUpload } from './upload';
export { createHostAuth } from './auth';
export type { AuthSession, HostAuth } from './auth';

function createTrpc(url: string, getToken?: () => Promise<string | null>) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url,
        // Bearer JWT on every call (RBAC_DESIGN §0.1) — resolved per request
        // because session tokens are short-lived. No token → no header; the
        // unconfigured server ignores it, the configured one rejects.
        headers: async () => {
          const token = await getToken?.();
          return token ? { authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}
type Trpc = ReturnType<typeof createTrpc>;

export interface ConnectOptions {
  /** tRPC endpoint, e.g. http://localhost:8787/trpc (the dev server default). */
  url?: string;
  /** Opaque scope path; partitions data server-side. */
  scope?: string;
  /**
   * Session-token supplier — typically HostAuth.getToken. Called per request
   * (tokens expire in minutes); omit when auth is unconfigured.
   */
  getToken?: () => Promise<string | null>;
}

export const DEFAULT_URL = 'http://localhost:8787/trpc';
export const DEFAULT_SCOPE = 'demo/sdm';

export interface RunInput {
  activityId: string;
  /** Anchor record id — omit for CREATE activities. */
  recordId?: string;
  /**
   * Attribute payload. Scalars are strings as the capture form submits;
   * file/photo attributes carry descriptor objects and multi values arrays —
   * arbitrary JSON, typed server-side by validateSubmission.
   */
  attributes?: Record<string, unknown>;
  waived?: Record<string, string>;
  acknowledgedWarnings?: boolean;
  callbackData?: unknown;
}

export class FluxusClient {
  private constructor(
    private readonly trpc: Trpc,
    readonly scope: string,
    readonly config: ConfigRaw,
    readonly adapter: MemoryAdapter,
    /**
     * Page definitions (path → def), snapshotted at connect like the record
     * partition. Defs are opaque here — PageDef and its validation belong to
     * the page builder. savePage/deletePage mutate this map optimistically
     * before the server round trip, so hosts keep synchronous reads.
     */
    readonly pages: Map<string, unknown>,
  ) {}

  /**
   * Fetch the scope's stored config, full record partition and page set, and
   * build the local snapshot. Throws (with the server's message) when the
   * server is unreachable or the scope has no config yet — hosts surface that
   * as their boot error; there is no localStorage fallback by ruling.
   */
  static async connect(options: ConnectOptions = {}): Promise<FluxusClient> {
    const trpc = createTrpc(options.url ?? DEFAULT_URL, options.getToken);
    const scope = options.scope ?? DEFAULT_SCOPE;
    const [config, partition, pageRows] = await Promise.all([
      trpc.config.get.query({ scope }) as Promise<ConfigRaw>,
      trpc.records.partition.query({ scope }) as Promise<RecordInstance[]>,
      trpc.pages.list.query({ scope }),
    ]);
    const adapter = new MemoryAdapter(config, {
      initialRecords: partition.map((r) => [r.id, r] as const),
    });
    const pages = new Map(pageRows.map((p) => [p.path, p.def]));
    return new FluxusClient(trpc, scope, config, adapter, pages);
  }

  /** Upsert a page: local snapshot first (sync readers), then the server. */
  async savePage(path: string, def: unknown): Promise<void> {
    this.pages.set(path, def);
    await this.trpc.pages.put.mutate({ scope: this.scope, path, def });
  }

  async deletePage(path: string): Promise<void> {
    this.pages.delete(path);
    await this.trpc.pages.delete.mutate({ scope: this.scope, path });
  }

  /**
   * The upload surface capture widgets inject (ATTRIBUTE_TYPES_FILES_SCALARS
   * §10): `upload` runs the full hash → EXIF → thumbnail → presign → direct-
   * to-R2 PUT flow and resolves to a stored descriptor; `resolveUrl` presigns a
   * GET for display. Scope is bound here so widgets stay scope-blind.
   */
  get uploads(): UploadService {
    const presign = (req: PresignRequest): Promise<Presigned> =>
      this.trpc.files.presignUpload.mutate({ scope: this.scope, ...req }) as Promise<Presigned>;
    return {
      upload: (attributeKey, file, onProgress) => runUpload(attributeKey, file, presign, onProgress),
      resolveUrl: async (storageKey) =>
        (await this.trpc.files.presignGet.query({ scope: this.scope, key: storageKey })).url,
    };
  }

  /** Re-fetch the partition into the same adapter; subscribers re-render. */
  async refresh(): Promise<void> {
    const partition = (await this.trpc.records.partition.query({ scope: this.scope })) as RecordInstance[];
    this.adapter.replaceRecords(partition.map((r) => [r.id, r] as const));
  }

  /**
   * Run an activity server-side (hooks + persistence live there only), then
   * refresh the snapshot. Refresh happens even when the run throws: a failing
   * after hook persists the entry by doctrine ("recorded, but no changes
   * applied"), so the snapshot must pick it up.
   */
  async runActivity(input: RunInput): Promise<RunActivityResult> {
    try {
      return (await this.trpc.activities.run.mutate({
        scope: this.scope,
        activityId: input.activityId,
        recordId: input.recordId,
        attributes: input.attributes ?? {},
        waived: input.waived,
        acknowledgedWarnings: input.acknowledgedWarnings,
        callbackData: input.callbackData,
      })) as RunActivityResult;
    } finally {
      await this.refresh();
    }
  }
}
