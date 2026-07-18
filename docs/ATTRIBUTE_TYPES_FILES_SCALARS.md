# Attribute Types: Files, Photos & Scalars — Build Spec

> **Status:** agreed 2026-07-18 after full discussion; spec for build. Cross-package (engine + sdm + server + client), hence root docs/.
> **Baseline:** the vertical `type` + `type_config` attribute system ([SDM_Change_Attribute_Type_System.md](../packages/sdm/docs/SDM_Change_Attribute_Type_System.md)). §5 creates the **type registry** that doc's §7 asked for.
> **Attribution:** decisions marked *(TT)* were proposed by the user; unmarked rulings were Claude-recommended and user-approved. All names in this doc were endorsed 2026-07-18.

## 0. Framing (agreed up front)

Attribute types define **how data is captured and how it is displayed** (photo → thumbnail, file → paperclip chip, date → date picker). Custom fields remain dumb storage: any custom field can hold any attribute type's value; there is no type-matching rule (reaffirms baseline §3) and **no custom-field redesign** — the closed primitive set gains nothing; descriptors sit in existing JSONB.

## 1. Types in this build

`photo`, `file`, `datetime`, `time`, `int`, `decimal`; `text` gains `multiline`. GIS types (`gis-point`/`gis-line`/`gis-polygon`, GeoJSON values, `multi` ⇒ native `Multi*` geometries) are agreed *direction* only — later build (map capture UI is the expensive part).

| type | value | type_config | Capture / display |
| :--- | :--- | :--- | :--- |
| `photo` | descriptor bag (§4) | `multi`, `max_count`, `max_size_mb` | Camera/gallery, images only. Thumb grid with add tile (messenger-style), tap for full size. |
| `file` | descriptor bag (§4) | `multi`, `max_count`, `max_size_mb`, `accept` (ext/MIME list) | Picker + drag-drop. Paperclip/name/size chip rows, click to download. No thumbnails. |
| `text` | string | `multiline` (textarea; one value with many lines — deliberately not the multi mechanism) | Existing, extended. |
| `datetime` | ISO 8601 **with local offset**, e.g. `2026-07-18T14:30:00+10:00` | — | Native picker; rendered local. Offset preserved so reports keep the wall-clock the user saw. |
| `time` | `HH:MM` 24 h, zone-less by design | — | Native time input. |
| `int` | JSON number (whole) | — | Numeric input, step 1. |
| `decimal` | JSON number | `decimal_places` (input step + rounding — presentation, like `multiline`) | Numeric input. Float-backed: fine for measurements, **not money-grade**; fixed-precision upgrade later behind the same type name (§11). |

## 2. Cardinality — one flag, `type_config.multi: true`

No `-multi` type variants (user's initial lean, reversed on discussion — reporting concern resolved by §9; addressability of specifics like `before_photo`/`after_photo` lives on the attribute definition either way). When `multi`, the value is always an array; `required` means ≥ 1 item.

Each type renders multi its own natural way — the widget is the type's business, not a second flag (`repeatable` rejected as an indistinguishable second spelling *(TT: proposed and self-retired)*):
- photo → thumb grid, add tile, per-thumb remove
- file → row list, add file
- scalars & (later) composites → "add another" repeat widget with per-item remove

Multi capture UI is **built for photo and file only** in this round; the flag is legal model-wide. `multi` on `composite` ("add another fixture row" — repeat widget ready-made for it) is deferred to a real case (§11).

## 3. Config vs validation — the boundary principle *(TT: reuse expressions instead of slots)*

**type_config holds only capture-shaping keys — things that must act *before a value exists*:** `accept` (file dialog filter), `max_size_mb` (enforced at presign, before bytes move), `max_count` (add-tile disables), `multi` (structural), `multiline`/`decimal_places` (input shape). Closed set; no format mini-language, ever.

**Every judgement about the value uses the existing FluxScript `validation`** with dot access into descriptor fields: `value > 0 and value <= 500`, `value.size <= 20000000`, `value.taken_at >= ctx.record.created_at`. The planned `min`/`max` slots were dropped before build. Descriptor dot-access is the composite addressing mechanism reused — no new expression machinery.

## 4. The descriptor — a composite-shaped value, stored by-value

A photo/file value is a typed bag, dot-addressed like a composite (`attrs.before_photo.taken_at`), stored **by-value** in the pipeline: history entries stay self-contained and immutable, no joins on any read path, and display components just receive a descriptor (by-value vs by-reference is invisible to them). Bytes never enter the pipeline.

Fields — `file`: `storage_key`, `name`, `mime`, `size` (int), `hash` (SHA-256, hex). `photo` adds: `width`, `height` (int), `thumb_key`, `lat`, `lng` (decimal), `taken_at` (datetime) *(TT: XY coordinates)*. In the DB this is nested JSON inside the same JSONB as every captured value — no special treatment, identical to composites.

## 5. Type registry (engine)

The descriptor sub-field schemas are **fixed by the type, not configurable** — photo must not be an actual composite: its sub-fields are system-written (uploader/EXIF), never user-captured, and identical everywhere. They are declared once in engine code; three consumers read the declaration: the uploader (what to write), `validateSubmission` (server-authoritative shape check), and `buildDslSchema` (typed dot-paths, autocomplete/static checks in hooks and validations). This registry is the artefact baseline-doc §7 requested; it grows an entry per type as types are added.

## 6. Blob storage — Cloudflare R2

User meant "S3-type"; R2 chosen on free tier: **10 GB storage / 1M writes / 10M reads per month, permanent (not a trial), zero egress** — comfortably POC-sized; only friction is a payment method on file to activate. Speaks the genuine S3 API (`@aws-sdk/client-s3` + presigner), so code is byte-portable to AWS S3 or Backblaze B2; the provider never leaks past one server module.

- One **private** bucket per environment (mirrors the Neon dev/prod split). All access via short-TTL presigned URLs; no public URLs, ever.
- Keys: `<yyyy>/<mm>/<uuid>/<sanitised-name>`; thumb at `…/<uuid>/thumb.jpg`.
- Server seam: `packages/server/src/services/blob.ts` — the only module touching the S3 client. tRPC router `files`: `presignUpload` (mutation; validates size/MIME against the attribute's type_config **before** signing), `presignGet` (query). Env: `FLUXUS_R2_ACCOUNT_ID`, `FLUXUS_R2_ACCESS_KEY_ID`, `FLUXUS_R2_SECRET_ACCESS_KEY`, `FLUXUS_R2_BUCKET`.

### Upload flow (messenger-style)

Pick/drag/camera → immediate local preview with progress → client computes SHA-256, extracts EXIF (`lat`/`lng`/`taken_at`), generates thumb (canvas, ~320 px long edge) → `files.presignUpload` per object → browser `PUT`s directly to R2 (bytes never transit our server) → form stays editable; **submit waits for uploads to settle** (failed uploads: retry/remove) → submission carries descriptors through the normal pipeline. Presigned URL is signed for the declared content length + MIME, so it can't be reused for something bigger. Display fetches presigned GETs on demand (browser-cacheable).

## 7. Cost safeguards (R2 has no native hard spend cap — enforcement is ours, at the presign chokepoint)

1. **Per-attribute** — `max_size_mb` / `max_count`: refused at presign, re-checked at submit.
2. **Platform per-file ceiling** (default 20 MB) regardless of config — a config typo can't open the door to video uploads.
3. **Environment fuse** — server refuses all presigns once the ledger's `SUM(size)` (§8) passes a threshold (default 8 GB, under the free 10): uploads fail with "storage limit reached" instead of a bill arriving.
4. **Cloudflare billing notification** as backstop (dashboard task on the user's account).

Read ops (thumb fetches vs 10M/month free) are unreachable at POC scale.

## 8. Attachments ledger *(TT: proposed the table; shaped in discussion to ledger-not-reference)*

Table `attachments`: one row per bucket object — `storage_key`, `size`, `mime`, `hash`, photo metadata, `status: pending → committed`, `created_at`. Row inserted at presign; flipped to `committed` when a submission referencing it lands.

**It is not the source of truth and nothing references its rows** — pipeline values stay by-value (a GC bug can therefore never corrupt history). It exists for the bucket-side and cross-system questions the pipeline is bad at:
- **Quota fuse**: local `SUM(size)` — no Cloudflare usage-API integration.
- **Duplicate / integrity queries** *(TT: deceptive photo reuse, duplicate standard docs)*: same `hash` re-uploaded across jobs → flag at upload or sweep in a report. (Hash catches identical files; near-duplicates need perceptual hashing — deferred §11. Legitimate sharing of standard docs is modelled as a document record type that jobs *reference*, vs deceptive re-upload, which the hash catches. EXIF `lat`/`lng`/`taken_at` support the same integrity story — photo geotagged miles from site, or timestamped before the job existed.)
- **Deferred GC becomes trivial**: orphans are rows still `pending` after N days.

Rebuildable from bucket listing + history if ever lost; losing it costs nothing user-visible.

## 9. Reporting projection

`rpt_attributes` already is the "queryable table of all attribute values" ([schema.ts](../packages/server/src/db/schema.ts)): one row per attribute per run, single text `value` cast on query, indexed `(key, value)`. The existing flattener ([host.ts](../packages/server/src/host.ts) `projectionAttributeRows`) already dot-flattens plain-object values — descriptors therefore project **automatically with zero new code**: `before_photo.hash`, `before_photo.taken_at`, … each an indexed row (`key = 'before_photo.hash' AND value = …`).

**One extension in this build:** the flattener treats arrays as leaves (today a multi value would land as one JSON-text blob). Extend it with positional segments — `site_photos.0.hash`, `site_photos.1.hash` — which also fixes the same latent gap for multi-select lists (`tags.0`).

## 10. Reusable capture components *(TT: requirement — page builder must not need a rebuild)*

- **Upload core** — presign calls, hashing, EXIF, thumbnail generation, progress orchestration — is plain browser logic with no React; it lives in `@fluxus/client` (the browser door both hosts stand on).
- **Widgets** (`PhotoInput`, `FileInput`, repeat wrapper, textarea/datetime/time/numeric inputs; display side: thumb grids, file chips, grid thumb column with count badge) are **pure controlled components**: value in, onChange out, config as props, upload service injected — zero imports from workbench stores/context. Authored in sdm for now; liftable unchanged to a shared package when the page builder becomes the second consumer. No new package until then.

## 11. Deferred (noted, not built)

- Garbage collection (ledger makes it a small job: stale `pending` rows).
- Repeating composites (`multi` on `composite` + repeat widget).
- Perceptual hashing for near-duplicate photos.
- Server-side image processing (thumbs/EXIF server-made, same `thumb_key` seam).
- Multi capture widget for scalars.
- **Fan-out capture** *(TT)*: one form session producing N history entries (e.g. twelve assets inspected in one sitting → twelve entries, not one entry with twelve rows). Cousin of CSV bulk import; open questions (atomicity, per-entry gates) parked with it.
- GIS build (§1); spatial querying/PostGIS.
- Money-grade fixed-precision decimal (string-backed, same type name).
- Also-ran engine details: `validateConfig` rejects `multi` on composite and unknown config keys per type; `coerceCaptured` gains `datetime`/`time`/`decimal` cases and is array-aware for multi.

## 12. Standing assumptions (flag if they break)

- Operations effectively single-timezone near-term: `datetime` with local offset is the right report-facing truth (approved 2026-07-18, recap deferred by user).
- No invoicing-grade money fields near-term (float decimal acceptable).

## 13. Migration & docs impact

- No DB migration for values (JSONB); **new table** `attachments` (§8) via Drizzle migration.
- Delete `selection` from `AttributeTypeConfig` and its two `"selection": "single"` occurrences in `packages/sdm/config/attributes.json` — `list` adopts `multi` (one spelling of cardinality platform-wide).
- Docs-with-code at build time: engine SPEC (type registry, validation, coercion), sdm SPEC (capture components), server SPEC (blob seam, `files` router, ledger, projection extension), GLOSSARY ("file descriptor", "attachments ledger", "blob store"), DEPLOYMENT.md (`FLUXUS_R2_*` per environment).
