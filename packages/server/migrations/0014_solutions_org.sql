-- `solutions.org_id` (ruled 2026-08-02): the last table not carrying the org
-- key. `operations`, `role_assignments`, `org_users` and `op_users` have all had
-- one since their own tiers landed; solutions predate the org tier (M13/M14),
-- which is the only reason it was missing.
--
-- Its job is **scoping** — keeping one org's solutions out of another's list.
-- It is NOT package identity: two orgs installing the same solution have
-- different `org_id` and the same package. What a solution *is* stays answered
-- by `id` plus `origin`/`origin_ref` (M12 provenance).
--
-- The primary key stays `id` alone. Solution ids remain **globally unique**,
-- which is the right posture for a package system (npm, crates and every other
-- registry work this way) and means no foreign key or composite key anywhere
-- has to change — `operations.solution_id` still references `solutions.id`
-- untouched. Adding a composite `(org_id, id)` key later stays open if per-org
-- id reuse ever becomes a requirement; nothing here forecloses it.
ALTER TABLE "solutions" ADD COLUMN "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "solutions_org" ON "solutions" USING btree ("org_id");
