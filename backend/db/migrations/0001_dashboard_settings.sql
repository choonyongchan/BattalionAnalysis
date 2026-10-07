-- Databases built from the retired 0000_needy_lockheed already have both tables, in an older
-- shape (rotations keyed by name, nullable end_date, updated_at). They were never written to,
-- so they are replaced; this refuses to run if either holds a row.
DO $$
BEGIN
  IF (to_regclass('public.public_holidays') IS NOT NULL AND EXISTS (SELECT 1 FROM public_holidays))
    OR (to_regclass('public.rotations') IS NOT NULL AND EXISTS (SELECT 1 FROM rotations)) THEN
    RAISE EXCEPTION 'public_holidays or rotations has rows; migrate them by hand before 0001';
  END IF;
END
$$;
--> statement-breakpoint
DROP TABLE IF EXISTS "public_holidays";
--> statement-breakpoint
DROP TABLE IF EXISTS "rotations";
--> statement-breakpoint
CREATE TABLE "public_holidays" (
	"date" date PRIMARY KEY NOT NULL,
	"name" text
);
--> statement-breakpoint
CREATE TABLE "rotations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rotations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	CONSTRAINT "rotations_ordered" CHECK ("rotations"."start_date" <= "rotations"."end_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rotations_natural_key" ON "rotations" USING btree ("name","start_date");