import { json, readJson, requireApiSession } from "@/lib/server/guard";
import { planExport } from "@/lib/integrations/export/source";
import { integrationRoute, limiter } from "@/lib/integrations/route";
import { exportPlanSchema } from "@/lib/integrations/types";

export const maxDuration = 60;

const take = limiter(10);

/** UIDs + sizes only; the client then pulls the folder down chunk by chunk. */
export const POST = integrationRoute(async (request) => {
	const session = await requireApiSession();
	const { folder, range } = await readJson(request, exportPlanSchema);
	take(session);
	return json({ ok: true, data: await planExport(session, folder, range) });
});
