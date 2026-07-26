ALTER TABLE "solutions" ADD COLUMN "origin" text DEFAULT 'authored' NOT NULL;--> statement-breakpoint
ALTER TABLE "solutions" ADD COLUMN "origin_ref" text;
