import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { withStore } from "@/lib/db/store";
import { mailRules, type MailRuleRow } from "@/lib/db/schema";
import { IntegrationError } from "@/lib/integrations/errors";

export function listRules(accountKey: string): Promise<MailRuleRow[]> {
	return withStore((db) =>
		db.select().from(mailRules).where(eq(mailRules.accountKey, accountKey)).orderBy(asc(mailRules.position), asc(mailRules.createdAt)),
	);
}

/** How many rules there are, and the next free position at the end. */
export async function ruleStats(accountKey: string): Promise<{ count: number; nextPosition: number }> {
	const [row] = await withStore((db) =>
		db
			.select({ n: sql<number>`count(*)::int`, max: sql<number>`coalesce(max(${mailRules.position}), -1)::int` })
			.from(mailRules)
			.where(eq(mailRules.accountKey, accountKey)),
	);
	return { count: row?.n ?? 0, nextPosition: (row?.max ?? -1) + 1 };
}

export async function insertRule(values: typeof mailRules.$inferInsert): Promise<MailRuleRow> {
	const [row] = await withStore((db) => db.insert(mailRules).values(values).returning());
	return row!;
}

export async function updateRule(
	accountKey: string,
	id: string,
	patch: Partial<Pick<typeof mailRules.$inferInsert, "sealed" | "action" | "enabled" | "position">>,
): Promise<MailRuleRow> {
	const [row] = await withStore((db) =>
		db
			.update(mailRules)
			.set({ ...patch, updatedAt: new Date() })
			.where(and(eq(mailRules.accountKey, accountKey), eq(mailRules.id, id)))
			.returning(),
	);
	if (!row) throw new IntegrationError("not_found", { message: "That rule no longer exists." });
	return row;
}

export async function deleteRule(accountKey: string, id: string): Promise<void> {
	const rows = await withStore((db) =>
		db.delete(mailRules).where(and(eq(mailRules.accountKey, accountKey), eq(mailRules.id, id))).returning({ id: mailRules.id }),
	);
	if (rows.length === 0) throw new IntegrationError("not_found", { message: "That rule no longer exists." });
}
