CREATE TABLE IF NOT EXISTS "org_users" (
	"org_id" text DEFAULT 'default' NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"auth_user_id" text,
	"status" text DEFAULT 'invited' NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_users_org_id_email_pk" PRIMARY KEY("org_id","email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "op_users" (
	"org_id" text DEFAULT 'default' NOT NULL,
	"operation_id" text NOT NULL,
	"email" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "op_users_org_id_operation_id_email_pk" PRIMARY KEY("org_id","operation_id","email")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_users_auth_user" ON "org_users" USING btree ("auth_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "op_users_operation" ON "op_users" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "op_users_email" ON "op_users" USING btree ("email");
