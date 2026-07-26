CREATE TABLE "role_assignments" (
	"org_id" text DEFAULT 'default' NOT NULL,
	"operation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "role_assignments_org_id_operation_id_user_id_pk" PRIMARY KEY("org_id","operation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "implementer_levels" (
	"user_id" text NOT NULL,
	"solution_id" text NOT NULL,
	"level" text NOT NULL,
	CONSTRAINT "implementer_levels_user_id_solution_id_pk" PRIMARY KEY("user_id","solution_id")
);
--> statement-breakpoint
CREATE INDEX "role_assignments_operation" ON "role_assignments" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "implementer_levels_solution" ON "implementer_levels" USING btree ("solution_id");
