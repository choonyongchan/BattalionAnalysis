-- Objects found on production (2026-10-07) that nothing in this repo creates or uses:
-- an empty `auth_failures` table and a `parade_ingest` login role holding INSERT, UPDATE and
-- DELETE on the parade tables. A login role nobody owns is a standing credential; drop both.
DROP TABLE IF EXISTS "auth_failures";
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'parade_ingest') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM parade_ingest;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM parade_ingest;
    REVOKE ALL ON SCHEMA public FROM parade_ingest;
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM parade_ingest', current_database());
    DROP ROLE parade_ingest;
  END IF;
END
$$;
