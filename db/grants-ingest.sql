-- The role the local WhatsApp runner connects as.
--
-- The runner stores raw parade states and writes the rows parsed from them, through
-- lib/pipeline.ts and nothing else. It runs on a laptop, so its credential gets exactly the
-- statements that module issues, and no FormSG, dashboard or auth table.
--
-- Usage:
--   psql "$DATABASE_URL" -v ingest_password="'<generated>'" -f db/grants-ingest.sql
-- then put that role's connection string in whatsapp/.env as DATABASE_URL.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'parade_ingest') THEN
    EXECUTE format('CREATE ROLE parade_ingest LOGIN PASSWORD %L', :ingest_password);
  ELSE
    EXECUTE format('ALTER ROLE parade_ingest PASSWORD %L', :ingest_password);
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO parade_ingest', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO parade_ingest;

GRANT SELECT, INSERT, UPDATE ON raw_messages TO parade_ingest;

GRANT SELECT, INSERT, DELETE ON
  parade_submissions,
  strength_rows,
  personnel_rows,
  command_roster_rows,
  section_counts
TO parade_ingest;

-- Identity columns draw from sequences. Harmless if Postgres does not require it.
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO parade_ingest;

-- Verification, run as parade_ingest:
--   SELECT count(*) FROM raw_messages;          -- must SUCCEED
--   SELECT count(*) FROM formsg_submissions;    -- must FAIL: permission denied
