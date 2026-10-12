import { z } from "zod";
import { json, parseWith, requireApiSession } from "@/lib/server/guard";
import { tenantKey } from "@/lib/integrations/crypto";
import { listEvents } from "@/lib/integrations/repo";
import { integrationRoute } from "@/lib/integrations/route";
import { EVENT_TARGETS } from "@/lib/integrations/types";

export const maxDuration = 60;

const querySchema = z.object({
	integrationId: z.uuid().optional(),
	target: z.enum(EVENT_TARGETS).optional(),
	cursor: z.coerce.number().int().positive().optional(),
	limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const GET = integrationRoute(async (request) => {
	const session = await requireApiSession();
	const query = parseWith(querySchema, Object.fromEntries(new URL(request.url).searchParams));
	return json({ ok: true, data: await listEvents(tenantKey(session), query) });
});
