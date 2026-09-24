-- Performance logging (docs/PERFORMANCE_LOGGING.md) — a pure addition, no
-- drops. Entirely disconnected from working data: its own table, retained 30
-- days (swept by the app opportunistically, not a DB job), could be wiped at
-- any time without loss.
CREATE TABLE "perf_spans" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "trace_id" text NOT NULL,
  "span_id" text NOT NULL,
  "parent_id" text,
  "side" text NOT NULL,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "org_id" text,
  "operation_id" text,
  "user_email" text,
  "started_at" timestamp with time zone NOT NULL,
  "duration_ms" integer NOT NULL,
  "outcome" text NOT NULL,
  "message" text,
  "counts" jsonb
);--> statement-breakpoint

-- One row per scope ('platform' or an operation id, §6). An operation row's
-- switches may be 'follow' (defer to the platform row); the platform row's
-- own are read as on/off only.
CREATE TABLE "perf_settings" (
  "scope" text PRIMARY KEY NOT NULL,
  "enabled" text DEFAULT 'on' NOT NULL,
  "server" text DEFAULT 'on' NOT NULL,
  "browser" text DEFAULT 'on' NOT NULL,
  "db_counts" text DEFAULT 'on' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX "perf_spans_started" ON "perf_spans" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "perf_spans_kind_name_started" ON "perf_spans" USING btree ("kind","name","started_at");--> statement-breakpoint
CREATE INDEX "perf_spans_trace" ON "perf_spans" USING btree ("trace_id");
