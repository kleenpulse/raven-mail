import { z } from "zod";
import { json, parseWith, readJson, requireApiSession } from "@/lib/server/guard";
import { integrationRoute, limiter } from "@/lib/integrations/route";
import { IntegrationError } from "@/lib/integrations/errors";
import { folderParam, uidParam } from "@/lib/api/mail-read";
import { finishFollowUp, listFollowUps, remindAbout, removeFollowUp, snoozeOneDay } from "@/lib/follow-ups/service";
import { remindSchema } from "@/lib/follow-ups/schema";
import { dueAtFor } from "@/lib/follow-ups/when";

export const maxDuration = 30;

const createSchema = z.object({ folder: folderParam, uid: uidParam, remind: remindSchema });
const patchSchema = z.object({ id: z.uuid(), action: z.enum(["done", "snooze"]) });
const idSchema = z.object({ id: z.uuid() });
const writes = limiter(30);

/** Open reminders, with `due` worked out now (time passed, no reply in the Inbox). */
export const GET = integrationRoute(async () => {
	const session = await requireApiSession();
	return json({ ok: true, data: await listFollowUps(session) });
});

/** Remind me if no reply, on a message already in the mailbox. The server reads the message. */
export const POST = integrationRoute(async (request) => {
	const session = await requireApiSession();
	writes(session);
	const { folder, uid, remind } = await readJson(request, createSchema);
	const dueAt = dueAtFor(remind);
	if (!dueAt) throw new IntegrationError("invalid_request", { message: "Pick a time in the next year.", hint: "It can't be in the past." });
	return json({ ok: true, data: await remindAbout(session, { folder, uid }, dueAt) });
});

/** Done, or snooze for a day. */
export const PATCH = integrationRoute(async (request) => {
	const session = await requireApiSession();
	writes(session);
	const { id, action } = await readJson(request, patchSchema);
	if (action === "done") {
		await finishFollowUp(session, id);
		return json({ ok: true, data: null });
	}
	return json({ ok: true, data: await snoozeOneDay(session, id) });
});

/** Cancel a reminder. */
export const DELETE = integrationRoute(async (request) => {
	const session = await requireApiSession();
	writes(session);
	const { id } = parseWith(idSchema, Object.fromEntries(new URL(request.url).searchParams));
	await removeFollowUp(session, id);
	return json({ ok: true, data: null });
});
