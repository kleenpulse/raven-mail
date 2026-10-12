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
	link: string;
};

export type BriefCard = {
	dateLabel: string;
	items: { subject: string; fromName: string; fromAddress: string; why: string[]; link: string }[];
	link: string;
};

export function absoluteMailLink(origin: string, ref: { folder: string; uid: string; messageId?: string | null }): string {
	return new URL(mailLink({ folder: ref.folder, uid: ref.uid, messageId: ref.messageId ?? undefined }), origin).toString();
}

export function emailCard(email: SharedEmail, origin: string, note?: string): EmailCard {
	const date = new Date(email.date);
	return {
		subject: truncate(email.subject, 250) || "(no subject)",
		fromName: truncate(email.from.name || email.from.address, 120),
		fromAddress: email.from.address.trim(),
		date: Number.isNaN(date.getTime()) ? null : date,
		preview: truncate(email.preview, PREVIEW_MAX),
		...(note?.trim() ? { note: truncate(note, NOTE_MAX) } : {}),
		...(email.messageId ? { messageId: email.messageId } : {}),
		link: absoluteMailLink(origin, email),
	};
}

export function briefCard(input: Pick<SendBriefInput, "dateLabel" | "items">, origin: string): BriefCard {
	return {
		dateLabel: truncate(input.dateLabel, 60),
		items: input.items.map((item) => ({
			subject: truncate(item.subject, 200) || "(no subject)",
			fromName: truncate(item.from.name || item.from.address, 80),
			fromAddress: item.from.address.trim(),
			why: item.why.map((w) => truncate(w, 60)).filter(Boolean),
			link: absoluteMailLink(origin, item),
		})),
		link: new URL("/overview", origin).toString(),
	};
}
