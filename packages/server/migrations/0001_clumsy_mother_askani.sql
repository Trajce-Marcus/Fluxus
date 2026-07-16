CREATE TABLE "pages" (
	"scope" text NOT NULL,
	"path" text NOT NULL,
	"def" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_scope_path_pk" PRIMARY KEY("scope","path")
);
