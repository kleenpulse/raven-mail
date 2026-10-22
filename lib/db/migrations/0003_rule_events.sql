CREATE TABLE "rule_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_key" text NOT NULL,
	"rule_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"action" text NOT NULL,
	"probability" real NOT NULL,
	"applied" boolean DEFAULT false NOT NULL,
	"undone" boolean DEFAULT false NOT NULL,
	"engine" text NOT NULL,
	"sealed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rule_events" ADD CONSTRAINT "rule_events_rule_id_mail_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."mail_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rule_events_rule_fingerprint_idx" ON "rule_events" USING btree ("rule_id","fingerprint");--> statement-breakpoint
CREATE INDEX "rule_events_account_idx" ON "rule_events" USING btree ("account_key","created_at" DESC NULLS LAST);