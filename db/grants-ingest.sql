-- Creates the parade_ingest role the WhatsApp runner connects as, limited to what lib/pipeline.ts issues.
-- Run once per database (re-run to rotate the password):
--   bun --env-file=.env.local scripts/apply-grants.ts db/grants-ingest.sql
-- then put the printed connection string in whatsapp/.env as DATABASE_URL.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'parade_ingest') THEN
    CREATE ROLE parade_ingest LOGIN;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO parade_ingest', current_database());
END
$$;
--> statement-breakpoint
ALTER ROLE parade_ingest PASSWORD :'password';
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO parade_ingest;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON raw_messages TO parade_ingest;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON parade_submissions TO parade_ingest;
--> statement-breakpoint
GRANT INSERT ON
  strength_rows,
  personnel_rows,
  command_roster_rows,
  section_counts
TO parade_ingest;

