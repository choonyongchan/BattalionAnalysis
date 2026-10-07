-- Lets the read-only dashboard role read the settings table 0003 created. Guarded, so a
-- database without dashboard_read (a fresh test branch) migrates cleanly; re-running
-- db/grants-dashboard.sql is not needed and would rotate the role's password.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_read') THEN GRANT SELECT ON "settings" TO dashboard_read; END IF; END $$;
