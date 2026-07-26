CREATE TABLE "page_versions" (
	"solution_id" text NOT NULL,
	"path" text NOT NULL,
	"version" integer NOT NULL,
	"def" jsonb NOT NULL,
	"readme" text NOT NULL,
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_versions_solution_id_path_version_pk" PRIMARY KEY("solution_id","path","version")
);
