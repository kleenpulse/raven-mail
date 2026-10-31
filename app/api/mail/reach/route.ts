import { HttpError, json, requireApiSession, route } from "@/lib/server/guard";
import { isDevSession } from "@/lib/mail/dev-store";
import { canReach } from "@/lib/mail/reach";

/*
 * Desktop only: can this computer reach the signed-in mail server? The
 * desktop app's own server is always reachable, so Next's offline check
 * can't tell; this is what the desktop offline notice asks instead.
 */
export const GET = route(async () => {
	if (!process.env.RAVEN_DESKTOP_BUILD) throw new HttpError(404, "Not found.", "not_found");
	const session = await requireApiSession();
	if (isDevSession(session)) return json({ ok: true, data: { reachable: true } });
	return json({ ok: true, data: { reachable: await canReach(session.imap.host, session.imap.port) } });
});
