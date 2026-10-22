import { z } from "zod";
import { json, readJson, requireApiSession } from "@/lib/server/guard";
import { integrationRoute, limiter } from "@/lib/integrations/route";
import { IntegrationError } from "@/lib/integrations/errors";
import { folderParam } from "@/lib/api/mail-read";
import { previewRule } from "@/lib/rules/run";
import { RULE_ACTIONS, RULE_CRITERIA_MAX } from "@/lib/rules/types";

export const maxDuration = 60;

const bodySchema = z.object({
	criteria: z.string().trim().min(1).max(RULE_CRITERIA_MAX),
	action: z.enum(RULE_ACTIONS),
	folder: folderParam.optional(),
});
// Previews are the easiest way to burn engine calls.
const previews = limiter(6);

/** How a rule with this wording would judge the newest 50 Inbox messages. Writes nothing. */
export const POST = integrationRoute(async (request) => {
	const session = await requireApiSession();
	previews(session);
	const input = await readJson(request, bodySchema);
	if (input.action === "move" && !input.folder) {
		throw new IntegrationError("invalid_request", { message: "Pick a folder to move it to." });
	}
	return json({ ok: true, data: await previewRule(session, input, request.signal) });
});
