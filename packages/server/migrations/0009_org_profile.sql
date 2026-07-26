ALTER TABLE "orgs" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;
