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