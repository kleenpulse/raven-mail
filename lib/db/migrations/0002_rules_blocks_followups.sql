CREATE TABLE "blocked_senders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_key" text NOT NULL,
	"kind" text NOT NULL,
	"fingerprint" text NOT NULL,
	"sealed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_key" text NOT NULL,
	"sealed" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_key" text NOT NULL,
	"sealed" text NOT NULL,
	"action" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "blocked_senders_account_fingerprint_idx" ON "blocked_senders" USING btree ("account_key","fingerprint");--> statement-breakpoint
CREATE INDEX "follow_ups_account_due_idx" ON "follow_ups" USING btree ("account_key","status","due_at");--> statement-breakpoint
CREATE INDEX "mail_rules_account_idx" ON "mail_rules" USING btree ("account_key","position");