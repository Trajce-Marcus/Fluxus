CREATE TABLE "solutions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"solution_id" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Split the opaque `scope` partition key into the endorsed solution/operation
-- keys (CONSOLE_RUNTIME_SPEC §1–2). Data-preserving column renames: the demo
-- bundle keeps its 'demo/sdm' key as BOTH the solution id and the operation id,
-- so no row values change — configs/pages become solution-keyed, records/rpt
-- become operation-keyed.
ALTER TABLE "sdm_configs" RENAME COLUMN "scope" TO "solution_id";--> statement-breakpoint
ALTER TABLE "pages" RENAME COLUMN "scope" TO "solution_id";--> statement-breakpoint
ALTER TABLE "records" RENAME COLUMN "scope" TO "operation_id";--> statement-breakpoint
ALTER TABLE "rpt_activities" RENAME COLUMN "scope" TO "operation_id";--> statement-breakpoint
ALTER TABLE "pages" RENAME CONSTRAINT "pages_scope_path_pk" TO "pages_solution_id_path_pk";--> statement-breakpoint
ALTER TABLE "records" RENAME CONSTRAINT "records_scope_id_pk" TO "records_operation_id_id_pk";--> statement-breakpoint
ALTER INDEX "records_scope_type" RENAME TO "records_operation_type";--> statement-breakpoint
ALTER INDEX "rpt_activities_scope_record" RENAME TO "rpt_activities_operation_record";--> statement-breakpoint
ALTER INDEX "rpt_activities_scope_activity" RENAME TO "rpt_activities_operation_activity";--> statement-breakpoint
-- Backfill the single implicit solution + operation for any existing bundle
-- (the live 'demo/sdm' deployment). Fresh dev DBs have no configs yet — the
-- seed script creates these rows instead. Idempotent via ON CONFLICT.
INSERT INTO "solutions" ("id", "name")
	SELECT DISTINCT "solution_id", 'Demo' FROM "sdm_configs"
	ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "operations" ("id", "org_id", "solution_id", "name")
	SELECT "id", 'default', "id", 'Demo' FROM "solutions"
	ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
CREATE INDEX "operations_solution" ON "operations" USING btree ("solution_id");--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_solution_id_solutions_id_fk" FOREIGN KEY ("solution_id") REFERENCES "public"."solutions"("id") ON DELETE no action ON UPDATE no action;
