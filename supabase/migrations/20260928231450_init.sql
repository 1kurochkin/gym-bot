CREATE TABLE "session" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"step" text NOT NULL,
	"step_no" integer DEFAULT 0 NOT NULL,
	"last_update_id" bigint DEFAULT 0 NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "settings" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"timezone" text,
	"bar_weight_lb" integer DEFAULT 45 NOT NULL,
	"plates_lb" jsonb NOT NULL,
	"exercise_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active_program_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;