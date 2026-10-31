import { after } from "next/server";
import { json, readJson, requireApiSession } from "@/lib/server/guard";
import { tryRecordEvent } from "@/lib/integrations/repo";
import { integrationRoute, limiter } from "@/lib/integrations/route";
import { cardLinker, shareEmail } from "@/lib/integrations/service";
import { shareEmailSchema } from "@/lib/integrations/types";

export const maxDuration = 60;

const take = limiter(30);

// A route, not a server action: Next runs a client's actions one at a time, and
// a share with retries must not hold up starring or archiving in the mail view.
export const POST = integrationRoute(async (request) => {
	const session = await requireApiSession();
	const input = await readJson(request, shareEmailSchema);
	take(session);
	const report = await shareEmail(session, input, cardLinker(request), {
		signal: request.signal,
		record: (event) => after(() => tryRecordEvent(event)),
	});
	return json({ ok: true, data: report });
});
