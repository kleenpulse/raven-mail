import "server-only";
import { eq, sql } from "drizzle-orm";
import { withDb } from "@/lib/db";
import { tourProgress } from "@/lib/db/schema";
import { tenantKey } from "@/lib/integrations/crypto";
import type { MailSession } from "@/lib/session";
import type { TourState } from "./types";

/** A client clock this far ahead would win every future write; pin it to now. */
const MAX_SKEW_MS = 60_000;

type Row = typeof tourProgress.$inferSelect;

function toState(row: Row): TourState {
	return {
		completed: row.completed,
		skipped: row.skipped,
		lastStep: row.lastStep,
		voice: row.voice,
		updatedAt: row.updatedAt.toISOString(),
	};
}

export async function getTour(session: MailSession): Promise<TourState | null> {
	const key = tenantKey(session);
	return withDb(async (db) => {
		const [row] = await db.select().from(tourProgress).where(eq(tourProgress.accountKey, key)).limit(1);
		return row ? toState(row) : null;
	});
}

/**
 * Upsert guarded by last-write-wins: an older write (a device that was offline)
 * never clobbers a newer one. Returns what the row holds afterwards, so the
 * caller learns when it lost.
 */
export async function saveTour(session: MailSession, state: TourState & { updatedAt: string }): Promise<TourState> {
	const key = tenantKey(session);
	const stamp = Math.min(Date.parse(state.updatedAt), Date.now() + MAX_SKEW_MS);
	const values = {
		accountKey: key,
		completed: state.completed,
		skipped: state.skipped,
		lastStep: state.lastStep,
		voice: state.voice,
		updatedAt: new Date(stamp),
	};
	return withDb(async (db) => {
		const [written] = await db
			.insert(tourProgress)
			.values(values)
			.onConflictDoUpdate({
				target: tourProgress.accountKey,
				set: {
					completed: values.completed,
					skipped: values.skipped,
					lastStep: values.lastStep,
					voice: values.voice,
					updatedAt: values.updatedAt,
				},
				setWhere: sql`${tourProgress.updatedAt} <= excluded.updated_at`,
			})
			.returning();
		if (written) return toState(written);
		const [current] = await db.select().from(tourProgress).where(eq(tourProgress.accountKey, key)).limit(1);
		return current ? toState(current) : toState({ ...values });
	});
}
