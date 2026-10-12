import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import {
	CONNECTION_KINDS,
	CONNECTION_STATUSES,
	EVENT_ACTIONS,
	EVENT_OUTCOMES,
	EVENT_TARGETS,
	type ConnectionMeta,
	type LastError,
} from "../integrations/types"; // relative: drizzle-kit loads this file outside Next's alias resolution
import { TOUR_VOICES } from "../tour/types";

/*
 * Tenancy: every row carries `account_key` — an HMAC of the mailbox identity
 * (see lib/integrations/crypto.ts). No email address is ever stored.
 */

const timestamps = {
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const integrations = pgTable(
	"integrations",
	{
		// App-generated: the id is bound into the secret's AEAD tag before insert.
		id: uuid("id").primaryKey(),
		accountKey: text("account_key").notNull(),
		kind: text("kind", { enum: CONNECTION_KINDS }).notNull(),
		label: text("label").notNull(),
		status: text("status", { enum: CONNECTION_STATUSES }).notNull().default("active"),
		/** Sealed JSON `{ url, signingSecret? }` — never leaves the server. */
		secret: text("secret").notNull(),
		/** HMAC of the normalised URL, so the same webhook can't be added twice. */
		fingerprint: text("fingerprint").notNull(),
		/** Masked URL for display. */
		hint: text("hint").notNull(),
		meta: jsonb("meta").$type<ConnectionMeta>().notNull().default({}),
		failureStreak: integer("failure_streak").notNull().default(0),
		lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
		lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
		lastError: jsonb("last_error").$type<LastError>(),
		...timestamps,
	},
	(t) => [
		uniqueIndex("integrations_account_fingerprint_idx").on(t.accountKey, t.fingerprint),
		index("integrations_account_idx").on(t.accountKey, t.createdAt),
	],
);

export const integrationEvents = pgTable(
	"integration_events",
	{
		id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
		accountKey: text("account_key").notNull(),
		integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),
		target: text("target", { enum: EVENT_TARGETS }).notNull(),
		action: text("action", { enum: EVENT_ACTIONS }).notNull(),
		outcome: text("outcome", { enum: EVENT_OUTCOMES }).notNull(),
		/** Connection label at the time — history stays readable after rename/disconnect. */
		label: text("label"),
		summary: text("summary").notNull(),
		errorCode: text("error_code"),
		latencyMs: integer("latency_ms"),
		attempts: integer("attempts"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("integration_events_account_idx").on(t.accountKey, t.id.desc()),
		index("integration_events_integration_idx").on(t.integrationId, t.id.desc()),
	],
);

/** Welcome-tour progress + narration accent, one row per mailbox. */
export const tourProgress = pgTable("tour_progress", {
	accountKey: text("account_key").primaryKey(),
	completed: boolean("completed").notNull().default(false),
	skipped: boolean("skipped").notNull().default(false),
	lastStep: integer("last_step").notNull().default(0),
	voice: text("voice", { enum: TOUR_VOICES }).notNull().default("us"),
	/** Client-stamped change time — the last-write-wins clock, not a server audit time. */
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export type IntegrationRow = typeof integrations.$inferSelect;
export type IntegrationEventRow = typeof integrationEvents.$inferSelect;
