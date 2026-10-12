import { readJson, requireApiSession } from "@/lib/server/guard";
import { readChunk } from "@/lib/integrations/export/source";
import { integrationRoute, limiter } from "@/lib/integrations/route";
import { exportChunkSchema } from "@/lib/integrations/types";

export const maxDuration = 60;

const take = limiter(240);

/**
 * One chunk of whole messages as mboxrd bytes. `application/mbox` is outside
 * Next's compressible types, so bytes go out as soon as they're ready.
 */
export const POST = integrationRoute(async (request) => {
	const session = await requireApiSession();
	const input = await readJson(request, exportChunkSchema);
	take(session);
	const chunk = await readChunk(session, input, request.signal);
	return new Response(new Uint8Array(chunk.body), {
		headers: {
			"Content-Type": "application/mbox",
			"Cache-Control": "private, no-store",
			"X-Raven-Export": JSON.stringify({ count: chunk.count, missing: chunk.missing }),
		},
	});
});
