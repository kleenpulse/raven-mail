import { format, isSameDay, isSameYear } from "date-fns";
import { splitAddressList } from "@/lib/format";

/*
 * When a reminder is due, and whether it still should be. Pure, so compose,
 * the routes and the tests share one set of rules. "Due" is worked out at load
 * time: the time has passed and no reply has reached the Inbox.
 */

/** How long to wait for a reply: a preset number of days, or a time the user picked. */
export type RemindChoice = { days: number } | { at: string };

export const REMIND_PRESETS = [
	{ days: 1, label: "1 day" },
	{ days: 3, label: "3 days" },
	{ days: 7, label: "1 week" },
] as const;

/** A reminder can't be set further out than this. */
export const MAX_REMIND_DAYS = 365;
/** Snooze pushes a due reminder this far. */
export const SNOOZE_MS = 86_400_000;

const DAY_MS = 86_400_000;

/** The due time for a choice, or null when it's in the past or too far out. */
export function dueAtFor(choice: RemindChoice, now = new Date()): Date | null {
	const due = "days" in choice ? new Date(now.getTime() + choice.days * DAY_MS) : new Date(choice.at);
	const ms = due.getTime();
	if (!Number.isFinite(ms) || ms <= now.getTime() || ms > now.getTime() + MAX_REMIND_DAYS * DAY_MS) return null;
	return due;
}

export function isDue(reminder: { dueAt: string; status: string }, now = new Date()): boolean {
	return reminder.status === "open" && Date.parse(reminder.dueAt) <= now.getTime();
}

/** Whether any of `messages` answers `messageId`, by In-Reply-To or References. */
export function hasReply(
	messages: { inReplyTo?: string; references?: string[] }[],
	messageId: string,
): boolean {
	return messages.some((m) => m.inReplyTo === messageId || Boolean(m.references?.includes(messageId)));
}

/** Who a reminder waits on, for display: up to two names, then a count. */
export function recipientLine(to: string | { name?: string; address: string }[]): string {
	const people = typeof to === "string" ? splitAddressList(to) : to;
	const names = people.map((p) => p.name?.trim() || p.address).filter(Boolean);
	if (names.length <= 2) return names.join(", ");
	return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

/** When a reminder fires, in a few words: "today at 15:00", "tomorrow", "Fri 24 Oct". */
export function dueLabel(iso: string, now = new Date()): string {
	const due = new Date(iso);
	if (isSameDay(due, now)) return `today at ${format(due, "HH:mm")}`;
	if (isSameDay(due, new Date(now.getTime() + DAY_MS))) return "tomorrow";
	return format(due, isSameYear(due, now) ? "EEE d MMM" : "d MMM yyyy");
}

/** A choice in words, for compose before the message has gone: "in 3 days", "on Fri 24 Oct". */
export function choiceLabel(choice: RemindChoice, now = new Date()): string {
	if ("days" in choice) {
		const preset = REMIND_PRESETS.find((p) => p.days === choice.days);
		return `in ${preset?.label ?? `${choice.days} days`}`;
	}
	const when = dueLabel(choice.at, now);
	return /^(today|tomorrow)/.test(when) ? when : `on ${when}`;
}
