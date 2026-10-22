import "server-only";
import { randomUUID } from "node:crypto";
import { openRow, sealRow } from "@/lib/db/sealed";
import { tenantKey } from "@/lib/integrations/crypto";
import { IntegrationError } from "@/lib/integrations/errors";
import type { MailRuleRow } from "@/lib/db/schema";
import type { MailSession } from "@/lib/session";
import { deleteRule, insertRule, listRules, ruleStats, updateRule } from "./repo";
import { RULE_CRITERIA_MAX, RULE_LIMIT, type RuleAction, type RuleDTO } from "./types";

type Sealed = { criteria: string; folder?: string };

function toDTO(row: MailRuleRow, key: string): RuleDTO | null {
	let sealed: Sealed;
	try {
		sealed = openRow<Sealed>("rules", row.sealed, key, row.id);
	} catch {
		// Sealed under an older app secret: unreadable, so it can't run either.
		return null;
	}
	return {
		id: row.id,
		criteria: sealed.criteria,
		action: row.action,
		...(sealed.folder ? { folder: sealed.folder } : {}),
		enabled: row.enabled,
		position: row.position,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function clean(input: { criteria: string; action: RuleAction; folder?: string }): Sealed {
	const criteria = input.criteria.trim().slice(0, RULE_CRITERIA_MAX);
	if (!criteria) throw new IntegrationError("invalid_request", { message: "Say which mail the rule is for." });
	if (input.action === "move" && !input.folder?.trim()) {
		throw new IntegrationError("invalid_request", { message: "Pick a folder to move it to." });
	}
	return input.action === "move" ? { criteria, folder: input.folder!.trim() } : { criteria };
}

export async function getRules(session: MailSession): Promise<RuleDTO[]> {
	const key = tenantKey(session);
	return (await listRules(key)).flatMap((row) => toDTO(row, key) ?? []);
}

export async function createRule(
	session: MailSession,
	input: { criteria: string; action: RuleAction; folder?: string },
): Promise<RuleDTO> {
	const key = tenantKey(session);
	const sealed = clean(input);
	const { count, nextPosition } = await ruleStats(key);
	if (count >= RULE_LIMIT) {
		throw new IntegrationError("limit_reached", { message: `You've reached ${RULE_LIMIT} rules.`, hint: "Delete one you no longer use first." });
	}
	const id = randomUUID();
	const row = await insertRule({ id, accountKey: key, sealed: sealRow("rules", sealed, key, id), action: input.action, position: nextPosition });
	return toDTO(row, key)!;
}

export async function editRule(
	session: MailSession,
	id: string,
	input: { criteria: string; action: RuleAction; folder?: string; enabled: boolean },
): Promise<RuleDTO> {
	const key = tenantKey(session);
	const row = await updateRule(key, id, {
		sealed: sealRow("rules", clean(input), key, id),
		action: input.action,
		enabled: input.enabled,
	});
	return toDTO(row, key)!;
}

export function removeRule(session: MailSession, id: string): Promise<void> {
	return deleteRule(tenantKey(session), id);
}
