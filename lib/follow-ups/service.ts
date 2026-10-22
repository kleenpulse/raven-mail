import "server-only";
import { randomUUID } from "node:crypto";
import { openRow, sealRow } from "@/lib/db/sealed";
import { tenantKey } from "@/lib/integrations/crypto";
import { IntegrationError } from "@/lib/integrations/errors";
import type { FollowUpRow } from "@/lib/db/schema";
import type { MailSession } from "@/lib/session";
import { countOpenFollowUps, deleteFollowUp, insertFollowUp, listOpenFollowUps, updateFollowUp } from "./repo";
import { FOLLOW_UP_LIMIT, type FollowUpDTO, type FollowUpTarget } from "./types";

function toDTO(row: FollowUpRow, key: string): FollowUpDTO | null {
	try {
		const target = openRow<FollowUpTarget>("follow-ups", row.sealed, key, row.id);
		return {
			...target,
			id: row.id,
			dueAt: row.dueAt.toISOString(),
			status: row.status,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
		};
	} catch {
		return null;
	}
}

export async function getOpenFollowUps(session: MailSession): Promise<FollowUpDTO[]> {
	const key = tenantKey(session);
	return (await listOpenFollowUps(key)).flatMap((row) => toDTO(row, key) ?? []);
}

export async function createFollowUp(session: MailSession, target: FollowUpTarget, dueAt: Date): Promise<FollowUpDTO> {
	const key = tenantKey(session);
	if ((await countOpenFollowUps(key)) >= FOLLOW_UP_LIMIT) {
		throw new IntegrationError("limit_reached", {
			message: `You have ${FOLLOW_UP_LIMIT} open reminders.`,
			hint: "Mark some done first.",
		});
	}
	const id = randomUUID();
	const row = await insertFollowUp({ id, accountKey: key, sealed: sealRow("follow-ups", target, key, id), dueAt });
	return toDTO(row, key)!;
}

export async function snoozeFollowUp(session: MailSession, id: string, dueAt: Date): Promise<FollowUpDTO> {
	const key = tenantKey(session);
	return toDTO(await updateFollowUp(key, id, { dueAt, status: "open" }), key)!;
}

export async function finishFollowUp(session: MailSession, id: string): Promise<void> {
	await updateFollowUp(tenantKey(session), id, { status: "done" });
}

export function removeFollowUp(session: MailSession, id: string): Promise<void> {
	return deleteFollowUp(tenantKey(session), id);
}
