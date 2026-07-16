CREATE TABLE "records" (
	"scope" text NOT NULL,
	"id" text NOT NULL,
	"type_ref" text NOT NULL,
	"custom_fields" jsonb NOT NULL,
	"activity_history" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "records_scope_id_pk" PRIMARY KEY("scope","id")
);
--> statement-breakpoint
CREATE TABLE "rpt_activities" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"record_id" text NOT NULL,
	"record_type" text NOT NULL,
	"activity_id" text NOT NULL,
	"activity_name" text NOT NULL,
	"author" text NOT NULL,
	"ts" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rpt_attributes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"activity_row_id" bigint NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"waive_desc" text
);
--> statement-breakpoint
CREATE TABLE "sdm_configs" (
	"scope" text PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rpt_attributes" ADD CONSTRAINT "rpt_attributes_activity_row_id_rpt_activities_id_fk" FOREIGN KEY ("activity_row_id") REFERENCES "public"."rpt_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "records_scope_type" ON "records" USING btree ("scope","type_ref");--> statement-breakpoint
CREATE INDEX "rpt_activities_scope_record" ON "rpt_activities" USING btree ("scope","record_id");--> statement-breakpoint
CREATE INDEX "rpt_activities_scope_activity" ON "rpt_activities" USING btree ("scope","activity_id");--> statement-breakpoint
CREATE INDEX "rpt_attributes_activity" ON "rpt_attributes" USING btree ("activity_row_id");--> statement-breakpoint
CREATE INDEX "rpt_attributes_key_value" ON "rpt_attributes" USING btree ("key","value");