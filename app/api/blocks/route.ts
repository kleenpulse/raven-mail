import { z } from "zod";
import { json, parseWith, readJson, requireApiSession } from "@/lib/server/guard";
import { integrationRoute, limiter } from "@/lib/integrations/route";
import { addBlock, getBlocks, removeBlock } from "@/lib/blocks/service";
import { BLOCK_KINDS } from "@/lib/blocks/types";

const addSchema = z.object({ kind: z.enum(BLOCK_KINDS), value: z.string().min(1).max(320) });
const idSchema = z.object({ id: z.uuid() });
const writes = limiter(30);

/** The mailbox's blocked senders, opened server-side for this session only. */
export const GET = integrationRoute(async () => {
	const session = await requireApiSession();
	return json({ ok: true, data: await getBlocks(session) });
});

export const POST = integrationRoute(async (request) => {
	const session = await requireApiSession();
	writes(session);
	const { kind, value } = await readJson(request, addSchema);
	return json({ ok: true, data: await addBlock(session, kind, value) });
});

export const DELETE = integrationRoute(async (request) => {
	const session = await requireApiSession();
	writes(session);
	const { id } = parseWith(idSchema, Object.fromEntries(new URL(request.url).searchParams));
	await removeBlock(session, id);
	return json({ ok: true, data: null });
});
