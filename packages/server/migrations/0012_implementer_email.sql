-- Rekey implementer_levels from the auth user id to the email, matching
-- org_users / op_users (RBAC_COMPACT "Users": email is the key). Without this a
-- solution admin can only be appointed AFTER they have signed in at least once,
-- which breaks the invite-first flow the whole model rests on.
--
-- Backfill through org_users.auth_user_id — the only place an auth id is mapped
-- to an email. Rows that do not resolve are dropped: an unmatched auth id names
-- someone who is not in the pool, and carrying it forward in a column typed as
-- an email would be corrupt data that the new grant checks would then read.
-- Implementer levels are dormant-until-declared, so an empty table is the
-- expected pre-migration state.
ALTER TABLE "implementer_levels" ADD COLUMN "email" text;--> statement-breakpoint
UPDATE "implementer_levels" il SET "email" = ou."email" FROM "org_users" ou WHERE ou."auth_user_id" = il."user_id";--> statement-breakpoint
DELETE FROM "implementer_levels" WHERE "email" IS NULL;--> statement-breakpoint
ALTER TABLE "implementer_levels" DROP CONSTRAINT "implementer_levels_user_id_solution_id_pk";--> statement-breakpoint
ALTER TABLE "implementer_levels" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "implementer_levels" ALTER COLUMN "email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "implementer_levels" ADD CONSTRAINT "implementer_levels_email_solution_id_pk" PRIMARY KEY("email","solution_id");
