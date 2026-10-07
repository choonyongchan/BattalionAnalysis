CREATE TABLE "sft_formsg" (
	"response_id" text PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"rank" text,
	"name" text,
	"name_key" text NOT NULL,
	"unit_coy" text,
	"company" "company",
	"group_ic" text,
	"pes_status" text,
	"informed_commander" boolean,
	"exercises" text,
	"sfabt_type" text,
	"window_confirmed" boolean,
	"location" text,
	"sft_date" date NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sft_formsg_date_idx" ON "sft_formsg" USING btree ("sft_date");