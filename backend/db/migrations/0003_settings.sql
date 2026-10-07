CREATE TABLE "settings" (
	"section" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Carries the two retired settings tables into the calendar section, so no holiday or
-- rotation is lost. A holiday stored without a name gets the generic label the dashboard
-- used to show for it. Writes nothing when both tables are empty, leaving the default.
INSERT INTO "settings" ("section", "value")
SELECT 'calendar', jsonb_build_object(
  'holidays', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'date', "date"::text,
      'name', COALESCE(NULLIF(btrim("name"), ''), 'Public holiday')
    ) ORDER BY "date") FROM "public_holidays"), '[]'::jsonb),
  'rotations', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'name', "name", 'start', "start_date"::text, 'end', "end_date"::text
    ) ORDER BY "start_date") FROM "rotations"), '[]'::jsonb)
)
WHERE EXISTS (SELECT 1 FROM "public_holidays") OR EXISTS (SELECT 1 FROM "rotations");
