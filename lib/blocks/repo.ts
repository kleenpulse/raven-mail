import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { withStore } from "@/lib/db/store";
import { blockedSenders, type BlockedSenderRow } from "@/lib/db/schema";
import { IntegrationError } from "@/lib/integrations/errors";

export function listBlocks(accountKey: string): Promise<BlockedSenderRow[]> {
	return withStore((db) =>
		db.select().from(blockedSenders).where(eq(blockedSenders.accountKey, accountKey)).orderBy(asc(blockedSenders.createdAt)),
	);
}

export async function countBlocks(accountKey: string): Promise<number> {
	const [row] = await withStore((db) =>
		db.select({ n: sql<number>`count(*)::int` }).from(blockedSenders).where(eq(blockedSenders.accountKey, accountKey)),
	);
	return row?.n ?? 0;
}

/** Adding the same address or domain twice keeps the first; returns null then. */
export async function insertBlock(values: typeof blockedSenders.$inferInsert): Promise<BlockedSenderRow | null> {
	const [row] = await withStore((db) =>
		db
			.insert(blockedSenders)
			.values(values)
			.onConflictDoNothing({ target: [blockedSenders.accountKey, blockedSenders.fingerprint] })
			.returning(),
	);
	return row ?? null;
}

export async function deleteBlock(accountKey: string, id: string): Promise<void> {
	const rows = await withStore((db) =>
		db
			.delete(blockedSenders)
			.where(and(eq(blockedSenders.accountKey, accountKey), eq(blockedSenders.id, id)))
			.returning({ id: blockedSenders.id }),
	);
	if (rows.length === 0) throw new IntegrationError("not_found", { message: "That sender isn't blocked anymore." });
}
