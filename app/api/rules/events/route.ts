import { z } from "zod";
import { json, readJson, requireApiSession } from "@/lib/server/guard";
import { integrationRoute, limiter } from "@/lib/integrations/route";
import { getActivity, undoActivity } from "@/lib/rules/activity";

const undoSchema = z.object({ id: z.uuid() });
const writes = limiter(30);

/** Recent activity: the newest 50 judgments. */
export const GET = integrationRoute(async () => {
	const session = await requireApiSession();
	return json({ ok: true, data: await getActivity(session) });
});

/** Undo an applied move, archive or trash. */
export const POST = integrationRoute(async (request) => {
	const session = await requireApiSession();
	writes(session);
	const { id } = await readJson(request, undoSchema);
	return json({ ok: true, data: await undoActivity(session, id) });
});
