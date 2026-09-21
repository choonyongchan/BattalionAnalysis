-- The read-only role the dashboard route connects as.
--
-- This is the thing Postgres gives us that the spreadsheet could not. Under Apps Script,
-- keeping the raw parade-state text away from the dashboard was a column projection in
-- DashboardFeed.js -- application code that any careless edit could undo, guarded only by a
-- test remembering to assert its absence. Here it is a privilege: a read route that selects
-- raw_messages.body gets an error from the database.
--
-- raw_messages.body is a duty commander's raw message. Observed bodies contain NRICs, full
-- names and diagnoses in one blob.
--
-- Run once per database, after the migration.
--
-- Usage:
--   psql "$DATABASE_URL" -v reader_password="$(openssl rand -hex 24)" -f db/grants.sql
-- then set DATABASE_URL_READONLY to that role's connection string.

\set ON_ERROR_STOP on

SELECT format('CREATE ROLE dashboard_reader LOGIN PASSWORD %L', :'reader_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_reader')
\gexec

SELECT format('ALTER ROLE dashboard_reader PASSWORD %L', :'reader_password')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_reader')
\gexec

-- GRANT CONNECT needs a literal database name, so the name is interpolated at run time
-- rather than hard-coded, which keeps this file usable against a Neon branch too.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO dashboard_reader', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO dashboard_reader;

-- Full read on everything the dashboard actually charts.
GRANT SELECT ON
  parade_submissions,
  strength_rows,
  personnel_rows,
  command_roster_rows,
  section_counts,
  formsg_submissions,
  formsg_statuses,
  symptom_categories,
  public_holidays,
  rotations
TO dashboard_reader;

-- raw_messages: COLUMN-LEVEL grant. `body` and `error` are omitted deliberately.
-- These four columns are all the dashboard needs to answer "which company filed, and when".
GRANT SELECT (id, wa_message_id, source, received_at, parade_response_id, processed_at)
  ON raw_messages TO dashboard_reader;

-- The lockout counter is the one thing the read path writes.
GRANT INSERT, DELETE, SELECT ON auth_failures TO dashboard_reader;

-- The Settings page edits these two through api/settings.ts, which uses the WRITE
-- connection. Nothing here grants the reader write access.

-- Default-deny for anything added later: a new table is not readable by dashboard_reader
-- until someone grants it explicitly, which is the safe direction for a table that might
-- hold free text.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM dashboard_reader;

-- Verification. Both of these should be run after applying:
--   SET ROLE dashboard_reader;
--   SELECT parade_response_id FROM raw_messages LIMIT 1;  -- must SUCCEED
--   SELECT body FROM raw_messages LIMIT 1;                -- must FAIL: permission denied
--   RESET ROLE;
