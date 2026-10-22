import { getPref } from "@/lib/prefs/store";

export function isTyping(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable));
}

/**
 * Gate for unmodified shortcuts. Character keys (c, j, /…) obey the
 * Single-Key Shortcuts setting; named keys (Escape, arrows) always pass.
 * Modifier combos are the caller's business and never reach here.
 */
export function allowSingleKey(e: Pick<KeyboardEvent, "key" | "target" | "metaKey" | "ctrlKey" | "altKey">): boolean {
	if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return false;
	return e.key.length !== 1 || getPref("keyboard.singleKey");
}

export type MessageKeyAction = "archive" | "trash" | "star" | "unread" | "reply" | "replyAll" | "forward";

/**
 * Triage keys for the focused message. Plain F and U stay the wide-view
 * toggle and back-to-list (app-shell); their Shift forms forward and mark
 * unread. A held key never repeats an action.
 */
export function messageKeyAction(
	e: Pick<KeyboardEvent, "key" | "target" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat">,
): MessageKeyAction | null {
	if (e.repeat || !allowSingleKey(e)) return null;
	// "#" is Shift+3 on US keyboards and its own key elsewhere, so Shift doesn't matter for it.
	if (e.key === "#") return "trash";
	if (e.shiftKey) {
		if (e.key === "F") return "forward";
		if (e.key === "U") return "unread";
		return null;
	}
	switch (e.key) {
		case "e":
			return "archive";
		case "s":
			return "star";
		case "r":
			return "reply";
		case "a":
			return "replyAll";
		default:
			return null;
	}
}

export type Shortcut = { keys: string[]; label: string; scope: "Anywhere" | "Mail" | "Search"; single: boolean };

/** What the Keyboard settings list shows; keep in step with the handlers. */
export const SHORTCUTS: Shortcut[] = [
	{ keys: ["mod", "K"], label: "Ask Jev", scope: "Anywhere", single: false },
	{ keys: ["mod", ","], label: "Open settings", scope: "Anywhere", single: false },
	{ keys: ["C"], label: "Compose", scope: "Anywhere", single: true },
	{ keys: ["/"], label: "Search", scope: "Search", single: true },
	{ keys: ["J"], label: "Next message", scope: "Mail", single: true },
	{ keys: ["K"], label: "Previous message", scope: "Mail", single: true },
	{ keys: ["U"], label: "Back to the list", scope: "Mail", single: true },
	{ keys: ["G"], label: "Go to Inbox", scope: "Mail", single: true },
	{ keys: ["F"], label: "Wide reader on or off", scope: "Mail", single: true },
	{ keys: ["Esc"], label: "Close message", scope: "Mail", single: false },
	{ keys: ["E"], label: "Archive", scope: "Mail", single: true },
	{ keys: ["#"], label: "Move to Trash", scope: "Mail", single: true },
	{ keys: ["S"], label: "Star or unstar", scope: "Mail", single: true },
	{ keys: ["Shift", "U"], label: "Mark unread", scope: "Mail", single: true },
	{ keys: ["R"], label: "Reply", scope: "Mail", single: true },
	{ keys: ["A"], label: "Reply all", scope: "Mail", single: true },
	{ keys: ["Shift", "F"], label: "Forward", scope: "Mail", single: true },
	{ keys: ["mod", "Z"], label: "Undo archive, move or delete", scope: "Mail", single: false },
];
