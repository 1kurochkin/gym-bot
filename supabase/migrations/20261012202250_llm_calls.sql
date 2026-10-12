CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"ok" boolean NOT NULL,
	"ms" integer NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "llm_calls_user_created" ON "llm_calls" USING btree ("user_id","created_at");