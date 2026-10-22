import "server-only";
import { and, desc, eq, gte, inArray, lte, not, or, type SQL } from "drizzle-orm";
import { withStore } from "@/lib/db/store";
import { ruleEvents, type RuleEventRow } from "@/lib/db/schema";
import { IntegrationError } from "@/lib/integrations/errors";
import { RULE_ACTIONS, RULE_LIMIT, RULE_THRESHOLDS, RUN_RECENT, STORED_SLACK } from "./types";

/** Recent activity keeps this many notable judgments per mailbox. */
export const NOTABLE_KEPT = 1000;
/**
 * Plain non-matches are kept only so a message isn't judged twice: enough for
 * every rule over the whole window, twice over for mail that moved on.
 */
export const NON_MATCHES_KEPT = 2 * RUN_RECENT * RULE_LIMIT;

/** `isNotable` in SQL. */
const notable = or(
	eq(ruleEvents.applied, true),
	...RULE_ACTIONS.map((a) => and(eq(ruleEvents.action, a), gte(ruleEvents.probability, RULE_THRESHOLDS[a] - STORED_SLACK))),
)!;

/** Of these fingerprints, the ones some rule already judged. */
export async function judgedFingerprints(accountKey: string, fingerprints: string[]): Promise<Set<string>> {
	if (fingerprints.length === 0) return new Set();
	const rows = await withStore((db) =>
		db
			.select({ fingerprint: ruleEvents.fingerprint })
			.from(ruleEvents)
			.where(and(eq(ruleEvents.accountKey, accountKey), inArray(ruleEvents.fingerprint, fingerprints))),
	);
	return new Set(rows.map((r) => r.fingerprint));
}

/**
 * Claim a judgment before acting on it. Only the run whose insert lands gets
 * the id back; any other run racing on the same rule and message gets null
 * and must not act.
 */
export async function claimEvent(values: typeof ruleEvents.$inferInsert): Promise<string | null> {
	const rows = await withStore((db) =>
		db
			.insert(ruleEvents)
			.values(values)
			.onConflictDoNothing({ target: [ruleEvents.ruleId, ruleEvents.fingerprint] })
			.returning({ id: ruleEvents.id }),
	);
	return rows[0]?.id ?? null;
}

/** After the IMAP action: applied, with the sealed details (new uid, or why it failed). */
export async function settleEvent(accountKey: string, id: string, patch: { applied: boolean; sealed: string }): Promise<void> {
	await withStore((db) =>
		db
			.update(ruleEvents)
			.set(patch)
			.where(and(eq(ruleEvents.accountKey, accountKey), eq(ruleEvents.id, id))),
	);
}

/** The newest notable judgments. */
export function listEvents(accountKey: string, limit = 50): Promise<RuleEventRow[]> {
	return withStore((db) =>
		db
			.select()
			.from(ruleEvents)
			.where(and(eq(ruleEvents.accountKey, accountKey), notable))
			.orderBy(desc(ruleEvents.createdAt))
			.limit(limit),
	);
}

export async function getEvent(accountKey: string, id: string): Promise<RuleEventRow> {
	const [row] = await withStore((db) =>
		db.select().from(ruleEvents).where(and(eq(ruleEvents.accountKey, accountKey), eq(ruleEvents.id, id))),
	);
	if (!row) throw new IntegrationError("not_found", { message: "That activity is gone.", hint: "It may have been cleared." });
	return row;
}

/** Claim an undo: only one caller flips an applied, not-yet-undone event. */
export async function claimUndo(accountKey: string, id: string): Promise<boolean> {
	const rows = await withStore((db) =>
		db
			.update(ruleEvents)
			.set({ undone: true })
			.where(and(eq(ruleEvents.accountKey, accountKey), eq(ruleEvents.id, id), eq(ruleEvents.applied, true), eq(ruleEvents.undone, false)))
			.returning({ id: ruleEvents.id }),
	);
	return rows.length > 0;
}

/** The undo move failed: let it be tried again. */
export async function releaseUndo(accountKey: string, id: string): Promise<void> {
	await withStore((db) =>
		db
			.update(ruleEvents)
			.set({ undone: false })
			.where(and(eq(ruleEvents.accountKey, accountKey), eq(ruleEvents.id, id))),
	);
}

/** Keep the newest of each kind per mailbox, so non-matches never push out what rules did. */
export async function pruneEvents(accountKey: string): Promise<void> {
	await withStore(async (db) => {
		const keep = async (kind: SQL, kept: number) => {
			const [cutoff] = await db
				.select({ createdAt: ruleEvents.createdAt })
				.from(ruleEvents)
				.where(and(eq(ruleEvents.accountKey, accountKey), kind))
				.orderBy(desc(ruleEvents.createdAt))
				.offset(kept)
				.limit(1);
			if (cutoff) {
				await db.delete(ruleEvents).where(and(eq(ruleEvents.accountKey, accountKey), kind, lte(ruleEvents.createdAt, cutoff.createdAt)));
			}
		};
		await keep(notable, NOTABLE_KEPT);
		await keep(not(notable), NON_MATCHES_KEPT);
	});
}
