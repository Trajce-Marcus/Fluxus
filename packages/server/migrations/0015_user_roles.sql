-- `role_assignments` → `user_roles`, and `user_id` → `email` (ruled 2026-08-02).
--
-- The rename retires the last piece of pre-users-model vocabulary. The rekey is
-- the point, though: this was the only one of the four tables still keyed on the
-- **auth provider's** user id rather than on our own identity, which is the
-- email. Two things were broken by that and are fixed here:
--
--   1. Roles could not be assigned to an invited user before their first
--      sign-in — they have no auth id yet — even though the Users ruling says
--      they can. Invite-first was half-implemented.
--   2. `removeOpUser` deletes a user's roles **by email**, so against auth-id
--      rows it silently deleted nothing. Removing someone from an operation
--      left their role grants sitting there, ready to reapply if re-added.
--
-- Backfill joins through `org_users.auth_user_id`, the only place an auth id is
-- mapped to an email. Rows that do not resolve are dropped: an unmatched auth id
-- names someone who is not in the pool, and a role grant for a person the
-- organisation does not know is not a grant worth keeping.
ALTER TABLE "role_assignments" RENAME TO "user_roles";--> statement-breakpoint
ALTER TABLE "user_roles" RENAME CONSTRAINT "role_assignments_org_id_operation_id_user_id_pk" TO "user_roles_org_id_operation_id_email_pk";--> statement-breakpoint
ALTER INDEX "role_assignments_operation" RENAME TO "user_roles_operation";--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "email" text;--> statement-breakpoint
UPDATE "user_roles" ur SET "email" = ou."email" FROM "org_users" ou WHERE ou."auth_user_id" = ur."user_id";--> statement-breakpoint
DELETE FROM "user_roles" WHERE "email" IS NULL;--> statement-breakpoint
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_org_id_operation_id_email_pk";--> statement-breakpoint
ALTER TABLE "user_roles" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "user_roles" ALTER COLUMN "email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_org_id_operation_id_email_pk" PRIMARY KEY("org_id","operation_id","email");
