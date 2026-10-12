import "server-only";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { withDb } from "@/lib/db";
import { integrationEvents, integrations, type IntegrationEventRow, type IntegrationRow } from "@/lib/db/schema";
import { IntegrationError } from "./errors";
import type { CheckSummary, ConnectionDTO, EventsPage, EventTarget, IntegrationEventDTO } from "./types";

// Every query is scoped by `accountKey` first — no row is reachable across mailboxes.

const EVENT_KEEP = 500;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toConnectionDTO(row: IntegrationRow): ConnectionDTO {
	return {
		id: row.id,
		kind: row.kind,
		label: row.label,
		status: row.status,
		hint: row.hint,
		meta: row.meta,
		failureStreak: row.failureStreak,
		lastOkAt: iso(row.lastOkAt),
		lastErrorAt: iso(row.lastErrorAt),
		lastError: row.lastError ?? null,
		createdAt: row.createdAt.toISOString(),
	};
}

export function toEventDTO(row: IntegrationEventRow): IntegrationEventDTO {
	return {
		id: row.id,
		integrationId: row.integrationId,
		target: row.target,
		action: row.action,
		outcome: row.outcome,
		label: row.label,
		summary: row.summary,
		errorCode: row.errorCode,
		latencyMs: row.latencyMs,
		attempts: row.attempts,
		createdAt: row.createdAt.toISOString(),
	};
}

/* ── Connections ─────────────────────────────────────────────────────────── */

export function listConnections(accountKey: string): Promise<IntegrationRow[]> {
	return withDb((db) =>
		db.select().from(integrations).where(eq(integrations.accountKey, accountKey)).orderBy(integrations.createdAt),
	);
}

export async function getConnection(accountKey: string, id: string): Promise<IntegrationRow> {
	const [row] = await withDb((db) =>
		db
			.select()
			.from(integrations)
			.where(and(eq(integrations.accountKey, accountKey), eq(integrations.id, id)))
			.limit(1),
	);
	if (!row) throw new IntegrationError("not_found");
	return row;
}

export async function findByFingerprint(accountKey: string, fingerprint: string): Promise<IntegrationRow | null> {
	const [row] = await withDb((db) =>
		db
			.select()
			.from(integrations)
			.where(and(eq(integrations.accountKey, accountKey), eq(integrations.fingerprint, fingerprint)))
			.limit(1),
	);
	return row ?? null;
}

export async function countConnections(accountKey: string): Promise<number> {
	const [row] = await withDb((db) =>
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(integrations)
			.where(eq(integrations.accountKey, accountKey)),
	);
	return row?.n ?? 0;
}

export async function insertConnection(values: typeof integrations.$inferInsert): Promise<IntegrationRow> {
	const [row] = await withDb((db) => db.insert(integrations).values(values).returning());
	return row!;
}

export async function updateConnection(
	accountKey: string,
	id: string,
	patch: Partial<Omit<typeof integrations.$inferInsert, "id" | "accountKey" | "kind">>,
): Promise<IntegrationRow> {
	const [row] = await withDb((db) =>
		db
			.update(integrations)
			.set({ ...patch, updatedAt: new Date() })
			.where(and(eq(integrations.accountKey, accountKey), eq(integrations.id, id)))
			.returning(),
	);
	if (!row) throw new IntegrationError("not_found");
	return row;
}

export async function deleteConnection(accountKey: string, id: string): Promise<IntegrationRow> {
	const [row] = await withDb((db) =>
		db
			.delete(integrations)
			.where(and(eq(integrations.accountKey, accountKey), eq(integrations.id, id)))
			.returning(),
	);
	if (!row) throw new IntegrationError("not_found");
	return row;
}

/* ── Activity ────────────────────────────────────────────────────────────── */

export type NewEvent = Omit<typeof integrationEvents.$inferInsert, "id" | "createdAt">;

/** Insert + keep the newest 500 per account, in one round-trip. */
export async function recordEvent(event: NewEvent): Promise<void> {
	await withDb((db) =>
		db.batch([
			db.insert(integrationEvents).values(event),
			db
				.delete(integrationEvents)
				.where(
					and(
						eq(integrationEvents.accountKey, event.accountKey),
						lt(
							integrationEvents.id,
							sql`(select id from ${integrationEvents} where ${integrationEvents.accountKey} = ${event.accountKey} order by id desc offset ${EVENT_KEEP - 1} limit 1)`,
						),
					),
				),
		]),
	);
}

/** Best effort: activity must never turn a success into a failure. */
export async function tryRecordEvent(event: NewEvent): Promise<void> {
	try {
		await recordEvent(event);
	} catch (err) {
		console.warn("[integrations] activity not recorded:", err instanceof Error ? err.message : err);
	}
}

export async function listEvents(
	accountKey: string,
	{ integrationId, target, cursor, limit = 20 }: { integrationId?: string; target?: EventTarget; cursor?: number; limit?: number },
): Promise<EventsPage> {
	const rows = await withDb((db) =>
		db
			.select()
			.from(integrationEvents)
			.where(
				and(
					eq(integrationEvents.accountKey, accountKey),
					integrationId ? eq(integrationEvents.integrationId, integrationId) : undefined,
					target ? eq(integrationEvents.target, target) : undefined,
					cursor ? lt(integrationEvents.id, cursor) : undefined,
				),
			)
			.orderBy(desc(integrationEvents.id))
			.limit(limit + 1),
	);
	const page = rows.slice(0, limit);
	return { events: page.map(toEventDTO), nextCursor: rows.length > limit ? page[page.length - 1]!.id : null };
}

/** Latest diagnostic run per built-in, for the card's "checked 3 min ago". */
export async function latestChecks(accountKey: string): Promise<{ mail: CheckSummary | null; jev: CheckSummary | null }> {
	const rows = await withDb((db) =>
		db
			.selectDistinctOn([integrationEvents.target])
			.from(integrationEvents)
			.where(
				and(
					eq(integrationEvents.accountKey, accountKey),
					eq(integrationEvents.action, "check"),
					inArray(integrationEvents.target, ["mail", "jev"]),
				),
			)
			.orderBy(integrationEvents.target, desc(integrationEvents.id)),
	);
	const summary = (target: "mail" | "jev"): CheckSummary | null => {
		const row = rows.find((r) => r.target === target);
		return row
			? {
					at: row.createdAt.toISOString(),
					outcome: row.outcome,
					summary: row.summary,
					errorCode: row.errorCode,
					latencyMs: row.latencyMs,
				}
			: null;
	};
	return { mail: summary("mail"), jev: summary("jev") };
}

/** Most recent export (any outcome), for the Data card. */
export async function lastExportEvent(accountKey: string): Promise<IntegrationEventDTO | null> {
	const [row] = await withDb((db) =>
		db
			.select()
			.from(integrationEvents)
			.where(and(eq(integrationEvents.accountKey, accountKey), eq(integrationEvents.target, "export")))
			.orderBy(desc(integrationEvents.id))
			.limit(1),
	);
	return row ? toEventDTO(row) : null;
}
