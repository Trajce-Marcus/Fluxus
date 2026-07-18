CREATE TABLE "attachments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"size" bigint NOT NULL,
	"mime" text NOT NULL,
	"hash" text,
	"width" integer,
	"height" integer,
	"lat" double precision,
	"lng" double precision,
	"taken_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "attachments_status" ON "attachments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "attachments_hash" ON "attachments" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "attachments_storage_key" ON "attachments" USING btree ("storage_key");