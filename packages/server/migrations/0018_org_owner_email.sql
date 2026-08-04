-- `orgs.contact_email` → `orgs.owner_email` (agreed 2026-08-04).
--
-- Two email columns on one row, born identical: `registerOrg` set
-- `contact_email` to the owner's address, and migration 0016 seeded
-- `owner_email` from `contact_email`. Nothing read `contact_email` for
-- behaviour — it was displayed in the platform org list and editable on the org
-- settings form, and that was all.
--
-- `owner_email` is the load-bearing one: it is the root of authority, and
-- Console access is derived from it. "Where we reach this organisation" is the
-- owner until billing exists to give a separate contact address a meaning, and
-- nothing sends mail at all yet — so a distinct billing contact would be
-- pre-engineering. The same reasoning that deferred the owner concept itself.
--
-- Safe by construction: 0016 already copied every non-null `contact_email` into
-- `owner_email`, and this re-runs that copy for any row where the owner is still
-- unset before dropping the column, so no address is lost even if one was edited
-- between the two migrations.
UPDATE "orgs" SET "owner_email" = "contact_email"
  WHERE "owner_email" IS NULL AND "contact_email" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" DROP COLUMN "contact_email";
