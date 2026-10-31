/*
 * The page ↔ main bridge (preload.ts exposes it as `window.ravenDesktop`).
 * The page can hand over new-mail news for a system notification; main can
 * send the page somewhere in the app. Everything that crosses is checked
 * here: main never trusts what the page sends, and only sends paths it
 * knows the app has.
 */

export const CHANNELS = {
	notifyNewMail: "raven:notify-new-mail",
	open: "raven:open",
} as const;

export type NewMail = { uid: string; from: string; subject: string };

export const MAX_ITEMS = 50;
export const MAX_TEXT = 200;

/** IMAP uids are unsigned 32-bit numbers; the app passes them as strings. */
const UID = /^[1-9]\d{0,9}$/;

const text = (value: unknown): string | null => (typeof value === "string" ? value.slice(0, MAX_TEXT) : null);

/** The items if the whole payload is well formed, else null. */
export function parseNewMail(payload: unknown): NewMail[] | null {
	if (!Array.isArray(payload) || payload.length === 0 || payload.length > MAX_ITEMS) return null;
	const items: NewMail[] = [];
	for (const raw of payload as unknown[]) {
		if (!raw || typeof raw !== "object") return null;
		const { uid, from, subject } = raw as Record<string, unknown>;
		const sender = text(from);
		const title = text(subject);
		if (typeof uid !== "string" || !UID.test(uid) || Number(uid) > 0xffff_ffff || sender === null || title === null) return null;
		items.push({ uid, from: sender, subject: title });
	}
	return items;
}

export type SenderFrame = { origin: string; isTop: boolean };

/** Only the app's own top frame may use the bridge: not an email's frame, not another site. */
export function trustedSender(frame: SenderFrame | null | undefined, appOrigin: string | null): boolean {
	return Boolean(frame && appOrigin && frame.isTop && frame.origin === appOrigin);
}

const OPEN_PARAMS: Record<string, ReadonlySet<string>> = {
	"/mail": new Set(["folder", "uid", "mid", "compose"]),
	"/overview": new Set(),
};

/**
 * `path` as a same-app path main may send the page to, or null. Only the
 * pages and query keys above get through, each key once.
 */
export function openPath(path: string): string | null {
	if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
	let url: URL;
	try {
		url = new URL(path, "http://raven.invalid");
	} catch {
		return null;
	}
	// No "..", "%2e" or other spellings that the URL parser would tidy into an allowed page.
	if (url.origin !== "http://raven.invalid" || url.hash || path.split("?")[0] !== url.pathname) return null;
	const allowed = OPEN_PARAMS[url.pathname];
	if (!allowed) return null;
	const keys = [...url.searchParams.keys()];
	if (keys.some((key) => !allowed.has(key)) || new Set(keys).size !== keys.length) return null;
	return `${url.pathname}${url.search}`;
}

/** Where clicking a notification for these messages goes. */
export function pathForNewMail(items: readonly NewMail[]): string {
	return items.length === 1 ? `/mail?folder=INBOX&uid=${items[0]!.uid}` : "/mail";
}

/** A notification's title and body: one message names its sender, several are counted. */
export function newMailNotice(items: readonly NewMail[]): { title: string; body: string } {
	if (items.length === 1) {
		const [item] = items;
		return { title: item!.from || "New message", body: item!.subject || "(no subject)" };
	}
	return { title: `${items.length} new messages`, body: [...new Set(items.map((item) => item.from).filter(Boolean))].slice(0, 3).join(", ") };
}
