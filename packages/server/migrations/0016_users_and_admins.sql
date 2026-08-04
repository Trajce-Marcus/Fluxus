-- One population of people, then grants (USERS.md, agreed 2026-08-04).
--
-- The 2026-08-02 shape gave each of the three membership tables a `level`
-- column, so "who is this person" and "what may they do" were answered by the
-- same row. This splits them: `users` is identity alone, and administration
-- becomes its own grant table per tier — `org_admins`, `sol_admins`,
-- `op_admins` — each keyed (target, person), so the row IS the appointment.
--
-- The rule the split exists to express: no administrator appoints another at
-- their own level. The owner appoints org admins; org admins appoint sol admins
-- and op admins; op admins add ordinary users and assign roles. Authority flows
-- downward only, which is why the owner now sits on the org row as its root.
--
-- Data is preserved by promotion, not by guesswork:
--   org_users.level='admin'  → an org_admins row
--   op_users.level='admin'   → an op_admins row (the op_users row is dropped:
--                              an admin row implies entry, so keeping both
--                              would record the same fact twice)
--   sol_users.level='write'  → a sol_admins row
--   sol_users.level='read'   → **dropped**. The viewer grade guarded nothing
--                              once appointment moved onto the admin tiers.
-- `user_roles` is untouched — it was already email-keyed by 0015 and is an
-- attribute of being an op user, not a membership layer of its own.

-- The owner: root of authority, seeded from the contact email, which until now
-- was where "the org's first admin" was remembered.
ALTER TABLE "orgs" ADD COLUMN "owner_email" text;--> statement-breakpoint
UPDATE "orgs" SET "owner_email" = "contact_email" WHERE "contact_email" IS NOT NULL;--> statement-breakpoint

-- org_users → users, with `level` promoted out into org_admins.
ALTER TABLE "org_users" RENAME TO "users";--> statement-breakpoint
ALTER TABLE "users" RENAME CONSTRAINT "org_users_org_id_email_pk" TO "users_org_id_email_pk";--> statement-breakpoint
ALTER INDEX "org_users_auth_user" RENAME TO "users_auth_user";--> statement-breakpoint

CREATE TABLE "org_admins" (
  "org_id" text DEFAULT 'default' NOT NULL,
  "email" text NOT NULL,
  "appointed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "org_admins_org_id_email_pk" PRIMARY KEY("org_id","email")
);--> statement-breakpoint
INSERT INTO "org_admins" ("org_id", "email")
  SELECT "org_id", "email" FROM "users" WHERE "level" = 'admin'
  ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "level";--> statement-breakpoint

-- op_users: entry only, with admins promoted out.
CREATE TABLE "op_admins" (
  "org_id" text DEFAULT 'default' NOT NULL,
  "operation_id" text NOT NULL,
  "email" text NOT NULL,
  "appointed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "op_admins_org_id_operation_id_email_pk" PRIMARY KEY("org_id","operation_id","email")
);--> statement-breakpoint
CREATE INDEX "op_admins_operation" ON "op_admins" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "op_admins_email" ON "op_admins" USING btree ("email");--> statement-breakpoint
INSERT INTO "op_admins" ("org_id", "operation_id", "email")
  SELECT "org_id", "operation_id", "email" FROM "op_users" WHERE "level" = 'admin'
  ON CONFLICT DO NOTHING;--> statement-breakpoint
DELETE FROM "op_users" WHERE "level" = 'admin';--> statement-breakpoint
ALTER TABLE "op_users" DROP COLUMN "level";--> statement-breakpoint

-- sol_users → sol_admins, one grade.
ALTER TABLE "sol_users" RENAME TO "sol_admins";--> statement-breakpoint
ALTER TABLE "sol_admins" RENAME CONSTRAINT "sol_users_email_solution_id_pk" TO "sol_admins_email_solution_id_pk";--> statement-breakpoint
ALTER INDEX "sol_users_solution" RENAME TO "sol_admins_solution";--> statement-breakpoint
DELETE FROM "sol_admins" WHERE "level" = 'read';--> statement-breakpoint
ALTER TABLE "sol_admins" DROP COLUMN "level";--> statement-breakpoint
ALTER TABLE "sol_admins" ADD COLUMN "appointed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

-- Every appointee must exist in the pool — the invite-then-appoint order, now
-- enforced rather than assumed. Orphans here would be grants to people the
-- organisation does not know.
DELETE FROM "org_admins" a WHERE NOT EXISTS (
  SELECT 1 FROM "users" u WHERE u."org_id" = a."org_id" AND u."email" = a."email");--> statement-breakpoint
DELETE FROM "op_admins" a WHERE NOT EXISTS (
  SELECT 1 FROM "users" u WHERE u."org_id" = a."org_id" AND u."email" = a."email");
