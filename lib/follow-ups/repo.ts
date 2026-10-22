import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { withStore } from "@/lib/db/store";
import { followUps, type FollowUpRow } from "@/lib/db/schema";
import { IntegrationError } from "@/lib/integrations/errors";

/** Open reminders, soonest first. */
export function listOpenFollowUps(accountKey: string): Promise<FollowUpRow[]> {
	return withStore((db) =>
		db
			.select()
			.from(followUps)
			.where(and(eq(followUps.accountKey, accountKey), eq(followUps.status, "open")))
			.orderBy(asc(followUps.dueAt)),
	);
}

export async function countOpenFollowUps(accountKey: string): Promise<number> {
	const [row] = await withStore((db) =>
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(followUps)
			.where(and(eq(followUps.accountKey, accountKey), eq(followUps.status, "open"))),
	);
	return row?.n ?? 0;
}

export async function insertFollowUp(values: typeof followUps.$inferInsert): Promise<FollowUpRow> {
	const [row] = await withStore((db) => db.insert(followUps).values(values).returning());
	return row!;
}

export async function updateFollowUp(
	accountKey: string,
	id: string,
	patch: Partial<Pick<typeof followUps.$inferInsert, "dueAt" | "status" | "sealed">>,
): Promise<FollowUpRow> {
	const [row] = await withStore((db) =>
		db
			.update(followUps)
			.set({ ...patch, updatedAt: new Date() })
			.where(and(eq(followUps.accountKey, accountKey), eq(followUps.id, id)))
			.returning(),
	);
	if (!row) throw new IntegrationError("not_found", { message: "That reminder no longer exists." });
	return row;
}

export async function deleteFollowUp(accountKey: string, id: string): Promise<void> {
	const rows = await withStore((db) =>
		db.delete(followUps).where(and(eq(followUps.accountKey, accountKey), eq(followUps.id, id))).returning({ id: followUps.id }),
	);
	if (rows.length === 0) throw new IntegrationError("not_found", { message: "That reminder no longer exists." });
}
