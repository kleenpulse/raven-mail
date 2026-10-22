import { z } from "zod";
import { json, parseWith, readJson, requireApiSession } from "@/lib/server/guard";
import { integrationRoute, limiter } from "@/lib/integrations/route";
import { folderParam } from "@/lib/api/mail-read";
import { decisionEngine } from "@/lib/jev/client";
import { createRule, editRule, getRules, moveRule, removeRule } from "@/lib/rules/service";
import { RULE_ACTIONS, RULE_CRITERIA_MAX } from "@/lib/rules/types";

const ruleSchema = z.object({
	criteria: z.string().min(1).max(RULE_CRITERIA_MAX),
	action: z.enum(RULE_ACTIONS),
	folder: folderParam.optional(),
});
const patchSchema = z.union([
	z.object({ id: z.uuid(), move: z.enum(["up", "down"]) }),
	ruleSchema.extend({ id: z.uuid(), enabled: z.boolean() }),
]);
const idSchema = z.object({ id: z.uuid() });
const writes = limiter(30);

/** The mailbox's rules in run order, and which engine would judge them. */
export const GET = integrationRoute(async () => {
	const session = await requireApiSession();
	return json({ ok: true, data: { rules: await getRules(session), engine: decisionEngine(session) } });
});

export const POST = integrationRoute(async (request) => {
	const session = await requireApiSession();
	writes(session);
	return json({ ok: true, data: await createRule(session, await readJson(request, ruleSchema)) });
});

/** Edit (wording, action, folder, on/off), or move up or down. */
export const PATCH = integrationRoute(async (request) => {
	const session = await requireApiSession();
	writes(session);
	const body = await readJson(request, patchSchema);
	if ("move" in body) {
		await moveRule(session, body.id, body.move);
		return json({ ok: true, data: null });
	}
	const { id, ...input } = body;
	return json({ ok: true, data: await editRule(session, id, input) });
});

/** Delete a rule; its activity goes with it. */
export const DELETE = integrationRoute(async (request) => {
	const session = await requireApiSession();
	writes(session);
	const { id } = parseWith(idSchema, Object.fromEntries(new URL(request.url).searchParams));
	await removeRule(session, id);
	return json({ ok: true, data: null });
});
