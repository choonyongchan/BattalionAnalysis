-- Singapore public holidays for 2025-2027, as gazetted by MOM.
--
-- `public_holidays` is a dashboard setting maintained by SQL (see docs/dashboard.md), so
-- this file is the seed of record: paste it into the Neon SQL editor, or run it with
--   bun --env-file=.env.local -e "import{neon}from'@neondatabase/serverless';import{readFileSync}from'node:fs';await neon(process.env.DATABASE_URL)(readFileSync('db/seed-public-holidays.sql','utf8'))"
--
-- Idempotent: ON CONFLICT DO NOTHING, so re-running inserts nothing and never overwrites a
-- name someone edited by hand. Correcting a date or name is a separate UPDATE.
--
-- A Sunday holiday is followed by its in-lieu Monday, named "... (observed)": the battalion
-- rests on Sundays, so the Monday is the day nobody is in camp and the day the charts must
-- mark. Both rows exist because either date may already be in use elsewhere.
--
-- 2025-05-03 Polling Day was a one-off public holiday for the General Election.
INSERT INTO public_holidays (date, name) VALUES
  -- 2025
  ('2025-01-01', 'New Year''s Day'),
  ('2025-01-29', 'Chinese New Year'),
  ('2025-01-30', 'Chinese New Year'),
  ('2025-03-31', 'Hari Raya Puasa'),
  ('2025-04-18', 'Good Friday'),
  ('2025-05-01', 'Labour Day'),
  ('2025-05-03', 'Polling Day'),
  ('2025-05-12', 'Vesak Day'),
  ('2025-06-07', 'Hari Raya Haji'),
  ('2025-08-09', 'National Day'),
  ('2025-10-20', 'Deepavali'),
  ('2025-12-25', 'Christmas Day'),
  -- 2026
  ('2026-01-01', 'New Year''s Day'),
  ('2026-02-17', 'Chinese New Year'),
  ('2026-02-18', 'Chinese New Year'),
  ('2026-03-21', 'Hari Raya Puasa'),
  ('2026-04-03', 'Good Friday'),
  ('2026-05-01', 'Labour Day'),
  ('2026-05-27', 'Hari Raya Haji'),
  ('2026-05-31', 'Vesak Day'),
  ('2026-06-01', 'Vesak Day (observed)'),
  ('2026-08-09', 'National Day'),
  ('2026-08-10', 'National Day (observed)'),
  ('2026-11-08', 'Deepavali'),
  ('2026-11-09', 'Deepavali (observed)'),
  ('2026-12-25', 'Christmas Day'),
  -- 2027
  ('2027-01-01', 'New Year''s Day'),
  ('2027-02-06', 'Chinese New Year'),
  ('2027-02-07', 'Chinese New Year'),
  ('2027-02-08', 'Chinese New Year (observed)'),
  ('2027-03-10', 'Hari Raya Puasa'),
  ('2027-03-26', 'Good Friday'),
  ('2027-05-01', 'Labour Day'),
  ('2027-05-17', 'Hari Raya Haji'),
  ('2027-05-20', 'Vesak Day'),
  ('2027-08-09', 'National Day'),
  ('2027-10-28', 'Deepavali'),
  ('2027-12-25', 'Christmas Day')
ON CONFLICT (date) DO NOTHING;
