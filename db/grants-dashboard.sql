-- The role api/dashboard.ts connects as: read-only, and unable to read a message body.
--
-- The dashboard charts parade states, report-sick and SFT submissions and the settings.
-- It never writes, and it never needs raw_messages.body (NRICs, diagnoses), so this role
-- gets SELECT on exactly what lib/dashboard.ts reads, and only the id and received_at
-- columns of raw_messages.
--
-- Usage (prints the connection string for DASHBOARD_DATABASE_URL; re-running rotates it):
--   bun --env-file=.env.local scripts/apply-grants.ts db/grants-dashboard.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_read') THEN
    CREATE ROLE dashboard_read LOGIN;
  END IF;
END
$$;
--> statement-breakpoint
ALTER ROLE dashboard_read PASSWORD :'password';
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO dashboard_read', current_database());
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO dashboard_read;
--> statement-breakpoint
GRANT SELECT ON
  parade_submissions,
  strength_rows,
  personnel_rows,
  command_roster_rows,
  report_sick_formsg,
  sft_formsg,
  settings
TO dashboard_read;
--> statement-breakpoint
GRANT SELECT (id, received_at) ON raw_messages TO dashboard_read;

-- Verification, run as dashboard_read:
--   SELECT id, received_at FROM raw_messages LIMIT 1;   -- must SUCCEED
--   SELECT body FROM raw_messages LIMIT 1;              -- must FAIL: permission denied
--   DELETE FROM settings;                               -- must FAIL: permission denied
