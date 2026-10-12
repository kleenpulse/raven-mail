import { readJson, requireApiSession } from "@/lib/server/guard";
import { ndjsonResponse } from "@/lib/server/ndjson";
import { CRASH_EVENT, integrationRoute, limiter } from "@/lib/integrations/route";
import { connectFlow } from "@/lib/integrations/service";
import { connectInputSchema } from "@/lib/integrations/types";

export const maxDuration = 60;

const take = limiter(10);

/** Streams the connect steps as NDJSON; failures before the stream starts are JSON errors. */
export const POST = integrationRoute(async (request) => {
	const session = await requireApiSession();
	const input = await readJson(request, connectInputSchema);
	take(session);
	return ndjsonResponse(connectFlow(session, input, request.signal), {
		signal: request.signal,
		label: "integrations/connect",
		crashEvent: CRASH_EVENT,
	});
});
