CREATE TABLE "sdm_config_versions" (
	"solution_id" text NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"readme" text NOT NULL,
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sdm_config_versions_solution_id_version_pk" PRIMARY KEY("solution_id","version")
);
