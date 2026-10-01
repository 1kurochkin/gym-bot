CREATE TABLE "invites" (
	"code" text PRIMARY KEY NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by" bigint,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "members" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"username" text,
	"invited_by" bigint NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;