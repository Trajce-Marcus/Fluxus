CREATE TABLE IF NOT EXISTS "orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- This migration used to INSERT ('default', 'Northwind Utilities') so the demo
-- tenancy had a name. Removed 2026-08-05 with every other prepopulation path:
-- a migration's job is schema, and inventing a tenant row is seeding. A fresh
-- database has no orgs until one is registered through platform.registerOrg.
-- Databases migrated before this edit still hold the row — deleting it is a
-- deliberate act, not a migration, because org 'default' may own real work.
