import "server-only";
import { randomUUID } from "node:crypto";
import { blockFingerprint, openRow, sealRow } from "@/lib/db/sealed";
import { tenantKey } from "@/lib/integrations/crypto";
import { IntegrationError } from "@/lib/integrations/errors";
import type { MailSession } from "@/lib/session";
import { countBlocks, deleteBlock, insertBlock, listBlocks } from "./repo";
import { BLOCK_LIMIT, type BlockDTO, type BlockKind } from "./types";

function normalise(kind: BlockKind, raw: string): string {
	const value = raw.trim().toLowerCase().replace(/^@/, "");
	const ok = kind === "address" ? /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) : /^[^\s@<>/]+\.[^\s@<>/]+$/.test(value);
	if (!ok) throw new IntegrationError("invalid_request", { message: kind === "address" ? "That isn't an email address." : "That isn't a domain." });
	return value;
}

export async function getBlocks(session: MailSession): Promise<BlockDTO[]> {
	const key = tenantKey(session);
	return (await listBlocks(key)).flatMap((row) => {
		try {
			return [{ id: row.id, kind: row.kind, value: openRow<string>("blocks", row.sealed, key, row.id), createdAt: row.createdAt.toISOString() }];
		} catch {
			return [];
		}
	});
}

/** Blocking twice is fine: the existing entry stays and comes back. */
export async function addBlock(session: MailSession, kind: BlockKind, raw: string): Promise<BlockDTO> {
	const key = tenantKey(session);
	const value = normalise(kind, raw);
	const fingerprint = blockFingerprint(key, kind, value);
	if ((await countBlocks(key)) >= BLOCK_LIMIT) {
		throw new IntegrationError("limit_reached", {
			message: `You've blocked ${BLOCK_LIMIT} senders.`,
			hint: "Unblock some in Settings first.",
		});
	}
	const id = randomUUID();
	const row = await insertBlock({ id, accountKey: key, kind, fingerprint, sealed: sealRow("blocks", value, key, id) });
	if (row) return { id: row.id, kind, value, createdAt: row.createdAt.toISOString() };
	const existing = (await getBlocks(session)).find((b) => b.kind === kind && b.value === value);
	if (!existing) throw new IntegrationError("internal");
	return existing;
}

export function removeBlock(session: MailSession, id: string): Promise<void> {
	return deleteBlock(tenantKey(session), id);
}
