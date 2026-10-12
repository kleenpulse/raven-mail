import { after } from "next/server";
import { json, readJson, requireApiSession } from "@/lib/server/guard";
import { tryRecordEvent } from "@/lib/integrations/repo";
import { integrationRoute, limiter } from "@/lib/integrations/route";
import { appOrigin, sendBrief } from "@/lib/integrations/service";
import { sendBriefSchema } from "@/lib/integrations/types";

export const maxDuration = 60;

const take = limiter(6);

/** Sends the brief exactly as the user sees it (their order, dismissals, Jev re-rank). */
export const POST = integrationRoute(async (request) => {
	const session = await requireApiSession();
	const input = await readJson(request, sendBriefSchema);
	take(session);
	const report = await sendBrief(session, input, appOrigin(request), {
		signal: request.signal,
		record: (event) => after(() => tryRecordEvent(event)),
	});
	return json({ ok: true, data: report });
});
