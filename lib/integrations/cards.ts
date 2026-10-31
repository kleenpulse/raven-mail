import { mailLink } from "@/lib/jev/ask/format";
import { truncate } from "./http";
import { NOTE_MAX, PREVIEW_MAX, type SendBriefInput, type SharedEmail } from "./types";

/** An email, ready for any provider to render. Text is trimmed but not escaped. */
export type EmailCard = {
	subject: string;
	fromName: string;
	fromAddress: string;
	date: Date | null;
	preview: string;
	note?: string;
	messageId?: string;
} & CardLink;

export type BriefCard = {
	dateLabel: string;
	items: ({ subject: string; fromName: string; fromAddress: string; why: string[] } & CardLink)[];
} & CardLink;

/** Where a card's "open" link goes. `ravenLink` is the desktop app's own link, when there is one. */
export type CardLink = { link: string; ravenLink?: string };

/** Turns a path in the app (`/mail?…`, `/overview`) into a card's links. */
export type CardLinker = (path: string) => CardLink;

/** The web app: links go straight to its pages. */
export function webLinker(origin: string): CardLinker {
	return (path) => ({ link: new URL(path, origin).toString() });
}

/**
 * The desktop app: its server is only on this computer, so links go through
 * the public site's `/open` page, which hands them to the app as `raven://`.
 */
export function desktopLinker(base: string): CardLinker {
	const open = new URL("/open", base).toString();
	return (path) => {
		const ravenLink = `raven://open${path}`;
		return { link: `${open}?to=${encodeURIComponent(ravenLink)}`, ravenLink };
	};
}

function mailPath(ref: { folder: string; uid: string; messageId?: string | null }): string {
	return mailLink({ folder: ref.folder, uid: ref.uid, messageId: ref.messageId ?? undefined });
}

export function emailCard(email: SharedEmail, links: CardLinker, note?: string): EmailCard {
	const date = new Date(email.date);
	return {
		subject: truncate(email.subject, 250) || "(no subject)",
		fromName: truncate(email.from.name || email.from.address, 120),
		fromAddress: email.from.address.trim(),
		date: Number.isNaN(date.getTime()) ? null : date,
		preview: truncate(email.preview, PREVIEW_MAX),
		...(note?.trim() ? { note: truncate(note, NOTE_MAX) } : {}),
		...(email.messageId ? { messageId: email.messageId } : {}),
		...links(mailPath(email)),
	};
}

export function briefCard(input: Pick<SendBriefInput, "dateLabel" | "items">, links: CardLinker): BriefCard {
	return {
		dateLabel: truncate(input.dateLabel, 60),
		items: input.items.map((item) => ({
			subject: truncate(item.subject, 200) || "(no subject)",
			fromName: truncate(item.from.name || item.from.address, 80),
			fromAddress: item.from.address.trim(),
			why: item.why.map((w) => truncate(w, 60)).filter(Boolean),
			...links(mailPath(item)),
		})),
		...links("/overview"),
	};
}
