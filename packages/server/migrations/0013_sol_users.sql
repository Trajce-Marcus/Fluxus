-- `implementer_levels` → `sol_users` (ruled 2026-08-02). One naming pattern
-- across the three membership layers: org_users / sol_users / op_users. The word
-- "implementer" is retired — it was the pre-users-model name for the same idea,
-- and carrying two vocabularies for one concept is what made the model read as
-- messy.
--
-- `level` collapses from read/write/admin to **read/write**. After the grant
-- rules moved onto the admin tiers (0011), 'admin' on a solution guarded exactly
-- two calls — solutions.update and solutions.delete — and both are org-admin
-- work, since the org admin is who creates solutions in the first place. A grade
-- that guards nothing is noise, so existing admins become 'write': look at the
-- model, or build it.
--
-- No org_id column, deliberately, unlike org_users/op_users: solution ids stay
-- globally unique, so the org is derivable through `solutions`. Storing it here
-- would be denormalisation with no query to justify it.
ALTER TABLE "implementer_levels" RENAME TO "sol_users";--> statement-breakpoint
ALTER TABLE "sol_users" RENAME CONSTRAINT "implementer_levels_email_solution_id_pk" TO "sol_users_email_solution_id_pk";--> statement-breakpoint
ALTER INDEX "implementer_levels_solution" RENAME TO "sol_users_solution";--> statement-breakpoint
UPDATE "sol_users" SET "level" = 'write' WHERE "level" = 'admin';
