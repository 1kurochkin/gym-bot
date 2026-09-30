CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"program_key" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "programs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "programs_user_key_version" ON "programs" USING btree ("user_id","program_key","version");--> statement-breakpoint
CREATE INDEX "programs_user_status" ON "programs" USING btree ("user_id","status");