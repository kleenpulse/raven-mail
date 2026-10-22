import { z } from "zod";
import { json, readJson, requireApiSession } from "@/lib/server/guard";
import { integrationRoute, limiter } from "@/lib/integrations/route";
import { uidParam } from "@/lib/api/mail-read";
import { runRules } from "@/lib/rules/run";
import { RUN_UID_LIMIT } from "@/lib/rules/types";

export const maxDuration = 60;

const bodySchema = z.object({ uids: z.array(uidParam).min(1).max(RUN_UID_LIMIT).optional() });
// "Run rules now" is the expensive one, like Deep triage; new-mail runs are bounded by their 20 uids and the poll.
const manual = limiter(3);
const arrivals = limiter(30);

/** Run the enabled rules over new Inbox uids, or the newest 50 ("Run rules now"). */
export const POST = integrationRoute(async (request) => {
	const session = await requireApiSession();
	const { uids } = await readJson(request, bodySchema);
	(uids ? arrivals : manual)(session);
	return json({ ok: true, data: await runRules(session, { uids, signal: request.signal }) });
});
