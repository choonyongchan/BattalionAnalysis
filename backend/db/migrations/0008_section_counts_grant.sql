-- Lets the read-only dashboard role read the counts each section header states, so the
-- Filing & Accuracy page can compare them with the names listed. Guarded like 0005, so a
-- database without dashboard_read (a fresh test branch) migrates cleanly.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_read') THEN GRANT SELECT ON "section_counts" TO dashboard_read; END IF; END $$;
