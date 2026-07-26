CREATE TABLE IF NOT EXISTS "orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "orgs" ("id", "name") VALUES ('default', 'Northwind Utilities') ON CONFLICT DO NOTHING;
