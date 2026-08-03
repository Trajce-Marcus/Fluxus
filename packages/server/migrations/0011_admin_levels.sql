ALTER TABLE "org_users" ADD COLUMN "level" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "op_users" ADD COLUMN "level" text DEFAULT 'user' NOT NULL;
