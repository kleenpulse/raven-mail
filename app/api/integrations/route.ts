import { json, requireApiSession } from "@/lib/server/guard";
import { integrationRoute } from "@/lib/integrations/route";
import { getOverview } from "@/lib/integrations/service";

export const maxDuration = 60;

// Never fails as a whole: a missing or sleeping database degrades the
// connections section only (see `dbError`); the built-ins always answer.
export const GET = integrationRoute(async () => {
	const session = await requireApiSession();
	return json({ ok: true, data: await getOverview(session) });
});
