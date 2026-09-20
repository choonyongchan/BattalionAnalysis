CREATE TYPE "public"."company" AS ENUM('Archer', 'Braves', 'Cougar', 'Stallion', 'Hercules');--> statement-breakpoint
CREATE TYPE "public"."intake_source" AS ENUM('whatsapp', 'manual');--> statement-breakpoint
CREATE TYPE "public"."outcome" AS ENUM('MC', 'Status', 'Both', 'None');--> statement-breakpoint
CREATE TYPE "public"."reason_category" AS ENUM('Att C', 'Status', 'Report Sick', 'MA', 'Off/Leave', 'Others');--> statement-breakpoint
CREATE TYPE "public"."report_sick_type" AS ENUM('RSI', 'RSO', 'MR', 'FFI', 'PENDING');--> statement-breakpoint
CREATE TYPE "public"."role_kind" AS ENUM('CDO', 'CDS', 'COS', 'PDS');--> statement-breakpoint
CREATE TYPE "public"."session" AS ENUM('FPS', 'LPS');--> statement-breakpoint
CREATE TYPE "public"."unit_type" AS ENUM('Company', 'HQ', 'PLATOON', 'SUBUNIT');--> statement-breakpoint
CREATE TABLE "auth_failures" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auth_failures_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command_roster_rows" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "command_roster_rows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"parade_response_id" text NOT NULL,
	"role_kind" "role_kind" NOT NULL,
	"unit_label" text,
	"rank" text,
	"name" text,
	"name_key" text,
	"is_vacant" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "formsg_statuses" (
	"response_id" text NOT NULL,
	"seq" smallint NOT NULL,
	"status_label" text NOT NULL,
	"days" smallint,
	CONSTRAINT "formsg_statuses_pk" PRIMARY KEY("response_id","seq")
);
--> statement-breakpoint
CREATE TABLE "formsg_submissions" (
	"response_id" text PRIMARY KEY NOT NULL,
	"form_id" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rank" text,
	"name" text,
	"name_key" text NOT NULL,
	"four_d" text,
	"four_d_normalised" text,
	"company" "company",
	"report_sick_type" "report_sick_type",
	"report_sick_time" time,
	"reason" text,
	"symptom_category_id" smallint,
	"symptom_other_text" text,
	"attested_genuine" boolean,
	"outcome" "outcome",
	"mc_days" smallint,
	CONSTRAINT "formsg_mc_days_sane" CHECK ("formsg_submissions"."mc_days" is null or "formsg_submissions"."mc_days" between 0 and 180)
);
--> statement-breakpoint
CREATE TABLE "parade_submissions" (
	"parade_response_id" text PRIMARY KEY NOT NULL,
	"company" "company" NOT NULL,
	"date" date NOT NULL,
	"session" "session" NOT NULL,
	"parade_time" time,
	"source_message_id" integer,
	"model" text,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personnel_rows" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "personnel_rows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"parade_response_id" text NOT NULL,
	"unit_label" text NOT NULL,
	"entry_index" smallint,
	"reason_category" "reason_category" NOT NULL,
	"four_d" text,
	"rank" text,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"duty_type" text,
	"sub_reason" text,
	"report_sick_type" "report_sick_type",
	"num_days" smallint,
	"is_permanent" boolean DEFAULT false NOT NULL,
	"start_date" date,
	"end_date" date,
	"start_time" time,
	"in_camp" boolean,
	"location" text,
	"source_line" text,
	CONSTRAINT "personnel_rows_num_days_non_negative" CHECK ("personnel_rows"."num_days" is null or "personnel_rows"."num_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "public_holidays" (
	"date" date PRIMARY KEY NOT NULL,
	"name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "raw_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"wa_message_id" text NOT NULL,
	"source" "intake_source" DEFAULT 'whatsapp' NOT NULL,
	"body" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parade_response_id" text,
	"error" text,
	"processed_at" timestamp with time zone,
	CONSTRAINT "raw_messages_wa_message_id_unique" UNIQUE("wa_message_id")
);
--> statement-breakpoint
CREATE TABLE "rotations" (
	"name" text PRIMARY KEY NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rotations_ordered" CHECK ("rotations"."end_date" is null or "rotations"."end_date" >= "rotations"."start_date")
);
--> statement-breakpoint
CREATE TABLE "section_counts" (
	"parade_response_id" text NOT NULL,
	"unit_label" text NOT NULL,
	"reason_category" "reason_category" NOT NULL,
	"stated_count" smallint,
	CONSTRAINT "section_counts_pk" PRIMARY KEY("parade_response_id","unit_label","reason_category")
);
--> statement-breakpoint
CREATE TABLE "strength_rows" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "strength_rows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"parade_response_id" text NOT NULL,
	"unit_label" text NOT NULL,
	"unit_type" "unit_type" NOT NULL,
	"total_strength" integer NOT NULL,
	"total_present" integer NOT NULL,
	"officer_strength" integer,
	"officer_present" integer,
	"wospec_strength" integer,
	"wospec_present" integer,
	"enlistee_strength" integer,
	"enlistee_present" integer,
	CONSTRAINT "strength_rows_non_negative" CHECK ("strength_rows"."total_strength" >= 0 and "strength_rows"."total_present" >= 0)
);
--> statement-breakpoint
CREATE TABLE "symptom_categories" (
	"id" smallint PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"display_order" smallint NOT NULL,
	CONSTRAINT "symptom_categories_label_unique" UNIQUE("label")
);
--> statement-breakpoint
ALTER TABLE "command_roster_rows" ADD CONSTRAINT "command_roster_rows_parade_response_id_parade_submissions_parade_response_id_fk" FOREIGN KEY ("parade_response_id") REFERENCES "public"."parade_submissions"("parade_response_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formsg_statuses" ADD CONSTRAINT "formsg_statuses_response_id_formsg_submissions_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."formsg_submissions"("response_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formsg_submissions" ADD CONSTRAINT "formsg_submissions_symptom_category_id_symptom_categories_id_fk" FOREIGN KEY ("symptom_category_id") REFERENCES "public"."symptom_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parade_submissions" ADD CONSTRAINT "parade_submissions_source_message_id_raw_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."raw_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_rows" ADD CONSTRAINT "personnel_rows_parade_response_id_parade_submissions_parade_response_id_fk" FOREIGN KEY ("parade_response_id") REFERENCES "public"."parade_submissions"("parade_response_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_counts" ADD CONSTRAINT "section_counts_parade_response_id_parade_submissions_parade_response_id_fk" FOREIGN KEY ("parade_response_id") REFERENCES "public"."parade_submissions"("parade_response_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strength_rows" ADD CONSTRAINT "strength_rows_parade_response_id_parade_submissions_parade_response_id_fk" FOREIGN KEY ("parade_response_id") REFERENCES "public"."parade_submissions"("parade_response_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_failures_at_idx" ON "auth_failures" USING btree ("at");--> statement-breakpoint
CREATE INDEX "command_roster_rows_submission_idx" ON "command_roster_rows" USING btree ("parade_response_id");--> statement-breakpoint
CREATE INDEX "formsg_submissions_submitted_at_idx" ON "formsg_submissions" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "formsg_submissions_name_key_idx" ON "formsg_submissions" USING btree ("name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "parade_submissions_natural_key" ON "parade_submissions" USING btree ("company","date","session");--> statement-breakpoint
CREATE INDEX "parade_submissions_date_idx" ON "parade_submissions" USING btree ("date");--> statement-breakpoint
CREATE INDEX "personnel_rows_submission_idx" ON "personnel_rows" USING btree ("parade_response_id");--> statement-breakpoint
CREATE INDEX "personnel_rows_name_key_idx" ON "personnel_rows" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "personnel_rows_four_d_idx" ON "personnel_rows" USING btree ("four_d");--> statement-breakpoint
CREATE INDEX "raw_messages_due_idx" ON "raw_messages" USING btree ("id") WHERE "raw_messages"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "raw_messages_parade_response_id_idx" ON "raw_messages" USING btree ("parade_response_id");--> statement-breakpoint
CREATE INDEX "strength_rows_submission_idx" ON "strength_rows" USING btree ("parade_response_id");