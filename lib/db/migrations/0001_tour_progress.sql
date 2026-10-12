CREATE TABLE "tour_progress" (
	"account_key" text PRIMARY KEY NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"last_step" integer DEFAULT 0 NOT NULL,
	"voice" text DEFAULT 'us' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
