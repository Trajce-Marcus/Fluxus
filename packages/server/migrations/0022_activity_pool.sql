-- The activity pool (APPS_AND_INSTANCES Part 1, 2026-10-04). Activities move
-- out of their workflow's def into one table per solution, so one activity can
-- serve several workflows; a workflow's def keeps an ordered list of
-- `{ "activity_ref": "<id>" }`. Reverses the 2026-08-08 ruling (0019) that
-- activities ride inside their workflow.
--
-- For each workflow: its nested activities are ordered by `sort_order`, then by
-- position (a missing `sort_order` sorts last); each goes into the pool without
-- `sort_order`, which a shared activity cannot have; the workflow is left with
-- references in that order. The same rules are written again in TypeScript
-- (`toActivityPool`, for published versions, which are never rewritten), and
-- one test fixture runs through both.
--
-- The same id in two workflows: one pool activity when the definitions match
-- (ignoring `sort_order`), and an ERROR naming the id when they do not —
-- keeping either one would silently change what the other workflow does.
--
-- Code and migration ship together: old code cannot read the new shape.
-- `created_by`/`updated_by` are null, as in 0019: the rows predate their own
-- authorship.

CREATE TABLE "sdm_activities" (
  "solution_id" text NOT NULL,
  "id" text NOT NULL,
  "def" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text,
  CONSTRAINT "sdm_activities_solution_id_id_pk" PRIMARY KEY("solution_id","id"),
  CONSTRAINT "sdm_activities_solution_id_solutions_id_fk"
    FOREIGN KEY ("solution_id") REFERENCES "solutions"("id")
);--> statement-breakpoint

DO $$
DECLARE
  wf record;
  entry record;
  act jsonb;
  existing jsonb;
  refs jsonb;
  seen text[];
  aid text;
BEGIN
  FOR wf IN SELECT "solution_id", "id", "def" FROM "sdm_workflows" ORDER BY "solution_id", "id" LOOP
    refs := '[]'::jsonb;
    seen := ARRAY[]::text[];
    FOR entry IN
      SELECT e.value AS v
      FROM jsonb_array_elements(COALESCE(wf."def"->'activities', '[]'::jsonb)) WITH ORDINALITY AS e(value, pos)
      ORDER BY (e.value->>'sort_order')::numeric NULLS LAST, e.pos
    LOOP
      IF entry.v ? 'activity_ref' THEN
        aid := entry.v->>'activity_ref';
      ELSE
        aid := entry.v->>'id';
        act := entry.v - 'sort_order';
        SELECT a."def" INTO existing FROM "sdm_activities" a
          WHERE a."solution_id" = wf."solution_id" AND a."id" = aid;
        IF FOUND THEN
          IF existing <> act THEN
            RAISE EXCEPTION 'activity pool migration: activity % in solution % is defined differently in two workflows — make them separate activities, then migrate',
              aid, wf."solution_id";
          END IF;
        ELSE
          INSERT INTO "sdm_activities" ("solution_id", "id", "def") VALUES (wf."solution_id", aid, act);
        END IF;
      END IF;
      IF NOT (aid = ANY(seen)) THEN
        seen := seen || aid;
        refs := refs || jsonb_build_array(jsonb_build_object('activity_ref', aid));
      END IF;
    END LOOP;
    UPDATE "sdm_workflows" SET "def" = jsonb_set("def", '{activities}', refs)
      WHERE "solution_id" = wf."solution_id" AND "id" = wf."id";
  END LOOP;
END $$;
