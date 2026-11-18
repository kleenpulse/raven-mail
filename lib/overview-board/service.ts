import "server-only";
import { eq, sql } from "drizzle-orm";
import { withDb } from "@/lib/db";
import { overviewBoard } from "@/lib/db/schema";
import { tenantKey } from "@/lib/integrations/crypto";
import type { MailSession } from "@/lib/session";
import { BOARD_PARTS, layoutDataSchema, widgetsDataSchema, type BoardDoc } from "./types";

/** A client clock this far ahead would win every future write; pin it to now. */
const MAX_SKEW_MS = 60_000;

type Row = typeof overviewBoard.$inferSelect;

/**
 * Rows to a record. The stamp is read from the column, never from `data`: the
 * column is what the write guard compares, so it is the only copy that counts.
 * A row this release cannot read is left out, and stays in the table.
 */
function toDoc(rows: readonly Row[]): BoardDoc {
	const doc: BoardDoc = {};
	for (const row of rows) {
		const updatedAt = row.updatedAt.toISOString();
		if (row.part === "widgets") {
			const data = widgetsDataSchema.safeParse(row.data);
			if (data.success) doc.widgets = { ...data.data, updatedAt };
		} else if (row.part === "lg" || row.part === "md" || row.part === "sm") {
			const data = layoutDataSchema.safeParse(row.data);
			if (data.success) doc[row.part] = { ...data.data, updatedAt };
		}
	}
	return doc;
}

export async function getBoard(session: MailSession): Promise<BoardDoc> {
	const key = tenantKey(session);
	return withDb(async (db) => toDoc(await db.select().from(overviewBoard).where(eq(overviewBoard.accountKey, key))));
}

/**
 * Saves the parts given, each guarded by last-write-wins on its own stamp: an
 * older write (a device that was offline) never replaces a newer one, and one
 * part losing does not stop another from winning. Returns the whole record as
 * stored afterwards, so the caller learns which parts it lost, and what any
 * part it did not send holds now.
 */
export async function saveBoard(session: MailSession, doc: BoardDoc): Promise<BoardDoc> {
	const key = tenantKey(session);
	const latest = Date.now() + MAX_SKEW_MS;
	const values = BOARD_PARTS.flatMap((part) => {
		const value = doc[part];
		if (!value) return [];
		const { updatedAt, ...data } = value;
		return [{ accountKey: key, part, data, updatedAt: new Date(Math.min(Date.parse(updatedAt), latest)) }];
	});
	return withDb(async (db) => {
		if (values.length > 0) {
			// One statement, so the parts land together or not at all.
			await db
				.insert(overviewBoard)
				.values(values)
				.onConflictDoUpdate({
					target: [overviewBoard.accountKey, overviewBoard.part],
					set: { data: sql`excluded.data`, updatedAt: sql`excluded.updated_at` },
					setWhere: sql`${overviewBoard.updatedAt} <= excluded.updated_at`,
				});
		}
		// Read back, not RETURNING: a row the guard kept is not returned, and that row is what the caller lost to.
		return toDoc(await db.select().from(overviewBoard).where(eq(overviewBoard.accountKey, key)));
	});
}
