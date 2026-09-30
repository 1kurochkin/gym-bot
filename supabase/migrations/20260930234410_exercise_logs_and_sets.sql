CREATE TABLE "exercise_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"workout_id" uuid,
	"program_id" uuid NOT NULL,
	"exercise_id" text NOT NULL,
	"exercise_name" text NOT NULL,
	"order" integer NOT NULL,
	"status" text NOT NULL,
	"substituted_for" text,
	"intensity" text,
	"planned_work_weight_lb" double precision,
	"step_lb_used" double precision,
	"warmup_tier" integer,
	"warmup_variant" text NOT NULL,
	"warmup_comment" text,
	"comment" text,
	"source" text NOT NULL,
	"local_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercise_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"exercise_log_id" uuid NOT NULL,
	"workout_id" uuid,
	"program_id" uuid NOT NULL,
	"exercise_id" text NOT NULL,
	"kind" text NOT NULL,
	"index" integer NOT NULL,
	"planned_weight_lb" double precision,
	"planned_reps" integer,
	"weight_lb" double precision,
	"reps" integer NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exercise_logs" ADD CONSTRAINT "exercise_logs_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_exercise_log_id_exercise_logs_id_fk" FOREIGN KEY ("exercise_log_id") REFERENCES "public"."exercise_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercise_logs_last_result" ON "exercise_logs" USING btree ("user_id","exercise_id","status","local_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sets_exercise_log" ON "sets" USING btree ("exercise_log_id");--> statement-breakpoint
CREATE INDEX "sets_program" ON "sets" USING btree ("program_id");