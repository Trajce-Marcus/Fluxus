-- "config" becomes "model" (APPS_AND_INSTANCES Part 3 §3.4, 2026-11-03): the
-- code's old name for a solution's model goes, here and in the code, in the
-- same change. A rename only — no data changes shape except the operation's
-- menu, which leaves its one-key `config` wrapper for a column of its own.
--
-- Deploy order: this applies on the first connect of the new server, after
-- which an older server, Console or Runtime still running reads names that
-- are gone — migrate, then deploy them together.
ALTER TABLE "sdm_config_versions" RENAME TO "sdm_model_versions";--> statement-breakpoint
ALTER TABLE "sdm_model_versions" RENAME COLUMN "config" TO "model";--> statement-breakpoint
ALTER TABLE "sdm_model_versions" RENAME CONSTRAINT "sdm_config_versions_solution_id_version_pk" TO "sdm_model_versions_solution_id_version_pk";--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "menu" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
UPDATE "operations" SET "menu" = COALESCE("config"->'menu', '[]'::jsonb);--> statement-breakpoint
ALTER TABLE "operations" DROP COLUMN "config";
