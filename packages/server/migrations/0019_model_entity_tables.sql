-- The SDM config becomes tables (designed + step 1 built 2026-08-08; this is
-- step 2). One table per collection, plus the menu.
--
-- The mismatch that forced it: the consistency unit is the WHOLE GRAPH — a
-- workflow references attributes, so validation is always global — while the
-- change unit is ONE ENTITY. A single jsonb blob made the *write* unit the whole
-- graph too, so `config.put` was last-write-wins across the entire model: two
-- sol admins editing two different record types had no logical conflict, yet one
-- silently lost their work. Step 1 (already shipped) narrowed the write API to
-- one entity per call under a per-solution lock; this migration puts the storage
-- underneath it, and with it per-entity authorship.
--
-- After this, the tables are truth and `sdm_configs.config` is a DERIVED draft
-- snapshot, refreshed on every write so `config.get` stays a single fetch. That
-- row is kept precisely because it is now pure derivation: droppable and
-- rebuildable at any time.
--
-- `def` is the entity verbatim, INCLUDING its own key/id, so assembly is
-- `rows.map(r => r.def)` with no reconstruction step. The duplicated identifier
-- is the price of an assembler that cannot be wrong.
--
-- `created_by`/`updated_by` hold email (the users-model key) and are nullable:
-- null means the row predates per-entity authorship — which is every row this
-- migration backfills. Never a fake author.

CREATE TABLE "sdm_attributes" (
  "solution_id" text NOT NULL,
  "key" text NOT NULL,
  "def" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text,
  CONSTRAINT "sdm_attributes_solution_id_key_pk" PRIMARY KEY("solution_id","key"),
  CONSTRAINT "sdm_attributes_solution_id_solutions_id_fk"
    FOREIGN KEY ("solution_id") REFERENCES "solutions"("id")
);--> statement-breakpoint

-- Activities ride INSIDE their workflow def (ruled 2026-08-08): the change unit
-- is the workflow — one person owns one at a time, and reviewing a workflow
-- change wants the whole thing in one view. Nesting keeps their authored order
-- for free. Created before sdm_record_types, which references it.
CREATE TABLE "sdm_workflows" (
  "solution_id" text NOT NULL,
  "id" text NOT NULL,
  "def" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text,
  CONSTRAINT "sdm_workflows_solution_id_id_pk" PRIMARY KEY("solution_id","id"),
  CONSTRAINT "sdm_workflows_solution_id_solutions_id_fk"
    FOREIGN KEY ("solution_id") REFERENCES "solutions"("id")
);--> statement-breakpoint

-- `workflow_ref` is the one reference the split can hand to Postgres. Named for
-- the config field it is lifted out of, not `workflow_id`.
CREATE TABLE "sdm_record_types" (
  "solution_id" text NOT NULL,
  "id" text NOT NULL,
  "workflow_ref" text NOT NULL,
  "def" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text,
  CONSTRAINT "sdm_record_types_solution_id_id_pk" PRIMARY KEY("solution_id","id"),
  CONSTRAINT "sdm_record_types_solution_id_solutions_id_fk"
    FOREIGN KEY ("solution_id") REFERENCES "solutions"("id"),
  CONSTRAINT "sdm_record_types_workflow_fk"
    FOREIGN KEY ("solution_id","workflow_ref") REFERENCES "sdm_workflows"("solution_id","id")
);--> statement-breakpoint

CREATE TABLE "sdm_functions" (
  "solution_id" text NOT NULL,
  "id" text NOT NULL,
  "def" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text,
  CONSTRAINT "sdm_functions_solution_id_id_pk" PRIMARY KEY("solution_id","id"),
  CONSTRAINT "sdm_functions_solution_id_solutions_id_fk"
    FOREIGN KEY ("solution_id") REFERENCES "solutions"("id")
);--> statement-breakpoint

CREATE TABLE "sdm_roles" (
  "solution_id" text NOT NULL,
  "id" text NOT NULL,
  "def" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text,
  CONSTRAINT "sdm_roles_solution_id_id_pk" PRIMARY KEY("solution_id","id"),
  CONSTRAINT "sdm_roles_solution_id_solutions_id_fk"
    FOREIGN KEY ("solution_id") REFERENCES "solutions"("id")
);--> statement-breakpoint

-- Keyed by solution ALONE: the default runtime menu is the config's only
-- non-collection field. A table rather than a column on `sdm_configs`, so that
-- nothing in `sdm_configs` is truth. `def` holds the menu array whole — menu
-- items are not independently authored entities.
CREATE TABLE "sdm_menus" (
  "solution_id" text PRIMARY KEY NOT NULL,
  "def" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text,
  CONSTRAINT "sdm_menus_solution_id_solutions_id_fk"
    FOREIGN KEY ("solution_id") REFERENCES "solutions"("id")
);--> statement-breakpoint

-- Backfill: explode every stored config into rows, leaving `config` in place as
-- the snapshot. Like the backfills in 0003 and 0016 this only SELECTs from rows
-- that already exist — on a fresh database it inserts nothing (nothing is
-- prepopulated, ruled 2026-08-05).
--
-- Authored array order is LOST here, by design: rows carry no order and assembly
-- is deterministic by key. Nothing reads authored order. Activities keep theirs,
-- inside their workflow def.
--
-- Workflows first — record types reference them.
INSERT INTO "sdm_workflows" ("solution_id", "id", "def")
  SELECT c."solution_id", e->>'id', e
  FROM "sdm_configs" c, jsonb_array_elements(COALESCE(c."config"->'workflows', '[]'::jsonb)) e
  WHERE jsonb_typeof(c."config"->'workflows') = 'array' AND e->>'id' IS NOT NULL
  ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "sdm_attributes" ("solution_id", "key", "def")
  SELECT c."solution_id", e->>'key', e
  FROM "sdm_configs" c, jsonb_array_elements(COALESCE(c."config"->'attributes', '[]'::jsonb)) e
  WHERE jsonb_typeof(c."config"->'attributes') = 'array' AND e->>'key' IS NOT NULL
  ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "sdm_record_types" ("solution_id", "id", "workflow_ref", "def")
  SELECT c."solution_id", e->>'id', e->>'workflow_ref', e
  FROM "sdm_configs" c, jsonb_array_elements(COALESCE(c."config"->'recordTypes', '[]'::jsonb)) e
  WHERE jsonb_typeof(c."config"->'recordTypes') = 'array'
    AND e->>'id' IS NOT NULL AND e->>'workflow_ref' IS NOT NULL
  ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "sdm_functions" ("solution_id", "id", "def")
  SELECT c."solution_id", e->>'id', e
  FROM "sdm_configs" c, jsonb_array_elements(COALESCE(c."config"->'functions', '[]'::jsonb)) e
  WHERE jsonb_typeof(c."config"->'functions') = 'array' AND e->>'id' IS NOT NULL
  ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "sdm_roles" ("solution_id", "id", "def")
  SELECT c."solution_id", e->>'id', e
  FROM "sdm_configs" c, jsonb_array_elements(COALESCE(c."config"->'access'->'roles', '[]'::jsonb)) e
  WHERE jsonb_typeof(c."config"->'access'->'roles') = 'array' AND e->>'id' IS NOT NULL
  ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "sdm_menus" ("solution_id", "def")
  SELECT c."solution_id", c."config"->'default_menu'
  FROM "sdm_configs" c
  WHERE jsonb_typeof(c."config"->'default_menu') = 'array'
  ON CONFLICT DO NOTHING;
