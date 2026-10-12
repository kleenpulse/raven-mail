CREATE TABLE "integration_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "integration_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_key" text NOT NULL,
	"integration_id" uuid,
	"target" text NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"label" text,
	"summary" text NOT NULL,
	"error_code" text,
	"latency_ms" integer,
	"attempts" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_key" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"secret" text NOT NULL,
	"fingerprint" text NOT NULL,
	"hint" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure_streak" integer DEFAULT 0 NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_events_account_idx" ON "integration_events" USING btree ("account_key","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "integration_events_integration_idx" ON "integration_events" USING btree ("integration_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_account_fingerprint_idx" ON "integrations" USING btree ("account_key","fingerprint");--> statement-breakpoint
CREATE INDEX "integrations_account_idx" ON "integrations" USING btree ("account_key","created_at");