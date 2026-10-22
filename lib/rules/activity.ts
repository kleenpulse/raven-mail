import "server-only";
import { openRow } from "@/lib/db/sealed";
import type { RuleEventRow } from "@/lib/db/schema";
import { tenantKey } from "@/lib/integrations/crypto";
import { IntegrationError } from "@/lib/integrations/errors";
import { devMoveWithUids, isDevSession } from "@/lib/mail/dev-store";
import { moveWithUids } from "@/lib/mail/imap";
import type { MailSession } from "@/lib/session";
import { claimUndo, getEvent, listEvents, releaseUndo } from "./events-repo";
import type { EventDetails } from "./run";
import { REMOVING_ACTIONS, type RuleEventDTO } from "./types";

function toDTO(row: RuleEventRow, key: string): RuleEventDTO | null {
	let details: EventDetails;
	try {
		details = openRow<EventDetails>("rule-events", row.sealed, key, row.id);
	} catch {
		return null;
	}
	return {
		id: row.id,
		ruleId: row.ruleId,
		action: row.action,
		probability: row.probability,
		applied: row.applied,
		undone: row.undone,
		engine: row.engine,
		...details,
		undoable: row.applied && !row.undone && REMOVING_ACTIONS.has(row.action) && Boolean(details.newUid && details.dest),
		createdAt: row.createdAt.toISOString(),
	};
}

/** The newest 50 judgments, for Recent activity. */
export async function getActivity(session: MailSession): Promise<RuleEventDTO[]> {
	const key = tenantKey(session);
	return (await listEvents(key)).flatMap((row) => toDTO(row, key) ?? []);
}

/**
 * Put back what a rule moved, by the new uid the server reported (COPYUID).
 * The flip to "undone" is claimed first, so two clicks move it back once.
 */
export async function undoActivity(session: MailSession, id: string): Promise<RuleEventDTO> {
	const key = tenantKey(session);
	const event = toDTO(await getEvent(key, id), key);
	if (!event) throw new IntegrationError("not_found", { message: "That activity can't be read anymore." });
	if (event.undone) return event;
	if (!event.undoable || !event.dest || !event.newUid) {
		throw new IntegrationError("invalid_request", {
			message: "This one can't be undone.",
			hint: "Your mail server didn't say where the message went. Find it in the folder and move it back.",
		});
	}
	if (!(await claimUndo(key, id))) return { ...event, undone: true, undoable: false };
	try {
		if (isDevSession(session)) {
			if (devMoveWithUids(event.dest, [event.newUid], event.folder).size === 0) throw new Error("Message not found");
		} else {
			await moveWithUids(session, event.dest, [event.newUid], event.folder);
		}
	} catch (err) {
		await releaseUndo(key, id);
		if (err instanceof Error && /not found/i.test(err.message)) {
			throw new IntegrationError("not_found", { message: "That message isn't there anymore.", hint: "It may have been moved again." });
		}
		throw err;
	}
	return { ...event, undone: true, undoable: false };
}
