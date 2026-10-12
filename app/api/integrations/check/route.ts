import { readJson, requireApiSession } from "@/lib/server/guard";
import { ndjsonResponse } from "@/lib/server/ndjson";
import { CRASH_EVENT, integrationRoute, limiter } from "@/lib/integrations/route";
import { checkFlow } from "@/lib/integrations/service";
import { checkInputSchema } from "@/lib/integrations/types";

export const maxDuration = 60;

const take = limiter(10);

/** Mail/Jev diagnostics or a connection's test message, streamed step by step. */
export const POST = integrationRoute(async (request) => {
	const session = await requireApiSession();
	const input = await readJson(request, checkInputSchema);
	take(session);
	return ndjsonResponse(checkFlow(session, input, request.signal), {
		signal: request.signal,
		label: "integrations/check",
		crashEvent: CRASH_EVENT,
	});
});
