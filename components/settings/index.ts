import type { PrefKey } from "@/lib/prefs/schema";

export const SECTION_IDS = ["appearance", "mail", "rules", "notifications", "sync", "keyboard", "tour", "account", "about"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const SECTIONS: Record<SectionId, { label: string; blurb: string; group: "Preferences" | "You" }> = {
	appearance: { label: "Appearance", blurb: "Change the theme, the size and the animations.", group: "Preferences" },
	mail: { label: "Mail", blurb: "How you read, send and delete mail.", group: "Preferences" },
	rules: { label: "Rules", blurb: "Sort new mail with rules written in plain words.", group: "Preferences" },
	notifications: { label: "Notifications", blurb: "How Raven tells you about new mail.", group: "Preferences" },
	sync: { label: "Sync & Storage", blurb: "How often Raven checks for mail, and what it saves on this device.", group: "Preferences" },
	keyboard: { label: "Keyboard", blurb: "Use keys instead of the mouse.", group: "Preferences" },
	tour: { label: "Tour & Voice", blurb: "The welcome tour and the voice that reads it.", group: "Preferences" },
	account: { label: "Account", blurb: "The mailbox you're signed in to.", group: "You" },
	about: { label: "About", blurb: "The app version, what changed, and a way to start over.", group: "You" },
};

export type SettingEntry = {
	id: string;
	section: SectionId;
	/** Card title the row sits under. */
	card: string;
	label: string;
	description?: string;
	keywords?: string;
	/** Prefs this row owns: drives the modified dot and per-row reset. */
	prefs?: PrefKey[];
	/** Control sits under the label instead of beside it. */
	stack?: boolean;
};

/** Every row, in display order. Search and the section pages both read this. */
export const SETTINGS: SettingEntry[] = [
	{
		id: "theme",
		section: "appearance",
		card: "Colors",
		label: "Theme",
		description: "Ember is light and warm. Nebula is dark teal. System matches your device.",
		keywords: "dark light mode color scheme",
	},
	{
		id: "ui-size",
		section: "appearance",
		card: "Display",
		label: "Size",
		description: "Makes everything bigger: text, buttons and spacing.",
		keywords: "interface zoom scale font text bigger larger accessibility",
		prefs: ["appearance.uiSize"],
	},
	{
		id: "density",
		section: "appearance",
		card: "Display",
		label: "Message Spacing",
		description: "How much space each message gets in the list.",
		keywords: "density compact comfortable rows",
		prefs: ["appearance.density"],
	},
	{
		id: "motion",
		section: "appearance",
		card: "Accessibility",
		label: "Reduce Motion",
		description: "Turn off sliding and bouncing animations. System matches your device.",
		keywords: "animation accessibility vestibular",
		prefs: ["appearance.motion"],
	},
	{
		id: "transparency",
		section: "appearance",
		card: "Accessibility",
		label: "Reduce Transparency",
		description: "Use solid backgrounds instead of see-through glass in menus and panels.",
		keywords: "blur glass contrast accessibility",
		prefs: ["appearance.reduceTransparency"],
	},
	{
		id: "ask-pill",
		section: "appearance",
		card: "Ask Jev",
		label: "Show Ask Jev Button",
		description:
			"The button at the bottom of the page. It hides while you scroll down and comes back when you scroll up. The Ask button in the side bar still opens it when it's off.",
		keywords: "jev floating pill button hide show scroll assistant",
		prefs: ["appearance.askPill"],
	},
	{
		id: "local-weather",
		section: "appearance",
		card: "Overview",
		label: "Local Weather",
		description:
			"Show the weather where you are under the date. Raven uses your rough location, rounded to about 1 km, only to look up the weather. Turning this off also forgets a location you shared on this device.",
		keywords: "location gps place weather temperature forecast privacy geolocation",
		prefs: ["overview.localWeather"],
	},
	{
		id: "remote-images",
		section: "mail",
		card: "Reading",
		label: "Load Images Automatically",
		description: "Show pictures from the sender's server without asking. Senders can sometimes tell when you open their mail.",
		keywords: "remote privacy tracking pixels",
		prefs: ["mail.remoteImages"],
	},
	{
		id: "force-dark",
		section: "mail",
		card: "Reading",
		label: "Dark Emails",
		description:
			"In the dark theme, make bright emails like newsletters dark too. Emails with their own dark look use it. Some logos can be hard to see, so each email has a Force dark button to switch back.",
		keywords: "force dark mode night newsletter bright white light invert theme",
		prefs: ["mail.forceDark"],
	},
	{
		id: "preload",
		section: "mail",
		card: "Reading",
		label: "Load Messages Early",
		description: "Download the messages you can see ahead of time, so they open right away.",
		keywords: "preload prefetch speed performance data bandwidth",
		prefs: ["mail.preload"],
	},
	{
		id: "threading",
		section: "mail",
		card: "Reading",
		label: "Conversations",
		description: "Group replies into one row, and show the whole conversation when you open a message.",
		keywords: "threads threading conversation group replies",
		prefs: ["mail.threading"],
	},
	{
		id: "split-inbox",
		section: "mail",
		card: "Inbox tabs",
		label: "Inbox Tabs",
		description: "Sort the Inbox into tabs, so updates and newsletters wait apart from mail from people.",
		keywords: "split inbox tabs categories important updates newsletters receipts promotions social",
		prefs: ["mail.splitInbox"],
	},
	{
		id: "split-tabs",
		section: "mail",
		card: "Inbox tabs",
		label: "Which Tabs",
		description: "Important is always there. A kind of mail without its own tab goes to Important.",
		keywords: "split inbox tabs categories updates newsletters receipts promotions social",
		prefs: ["mail.splitTabs"],
	},
	{
		id: "undo",
		section: "mail",
		card: "Deleting",
		label: "Undo Time",
		description: "How long you have to undo an archive, move or delete.",
		keywords: "delete trash archive move grace timer",
		prefs: ["mail.undoMs"],
	},
	{
		id: "undo-send",
		section: "mail",
		card: "Sending",
		label: "Undo Send",
		description: "How long you have to take back a message after you press Send.",
		keywords: "undo send unsend cancel recall delay wait",
		prefs: ["mail.undoSend"],
	},
	{
		id: "signature",
		section: "mail",
		card: "Sending",
		label: "Signature",
		description: "Added under new messages, and above the quote when you reply or forward. Saved on this device only.",
		keywords: "signature sign off footer name title",
		prefs: ["mail.signature"],
	},
	{
		id: "mail-layout",
		section: "mail",
		card: "Layout",
		label: "Mail Layout",
		description: "Set the message list back to its normal width.",
		keywords: "reset split pane reading pane width wide reader",
	},
	{
		id: "blocked",
		section: "mail",
		card: "Blocked senders",
		label: "Blocked Senders",
		description:
			"Their mail is hidden from your Inbox list, not deleted, so unread counts still include it. Saved to your account, so it works on every device.",
		keywords: "block blocked unblock spam sender domain screener",
		stack: true,
	},
	{
		id: "rules-list",
		section: "rules",
		card: "Your rules",
		label: "Rules",
		description:
			"Each rule is a few words about the mail it's for, and one thing to do with it. The first rule that fits an email acts on it. Saved to your account.",
		keywords: "rules filters automation sort archive move trash star read run",
		stack: true,
	},
	{
		id: "rules-new",
		section: "rules",
		card: "New rule",
		label: "Add a Rule",
		description: "Say which mail it's for and what to do, then preview it on your last 50 messages before you save.",
		keywords: "create rule filter preview dry run",
		stack: true,
	},
	{
		id: "rules-activity",
		section: "rules",
		card: "Recent activity",
		label: "Recent Activity",
		description: "What your rules did lately, and how sure they were. Moves can be undone here.",
		keywords: "rules log history undo activity",
		stack: true,
	},
	{
		id: "banner-position",
		section: "notifications",
		card: "New mail",
		label: "Pop-up Position",
		description: "Pick the corner for the new mail pop-up. It shows when unread mail reaches your Inbox, on any page, and hides after 8 seconds.",
		keywords: "banner toast popup alert corner arrival",
		prefs: ["notify.bannerPosition"],
	},
	{
		id: "focus-refetch",
		section: "sync",
		card: "Checking for mail",
		label: "Check When You Return",
		description: "Check for new mail when you switch back to this tab.",
		keywords: "focus refresh sync window tab reload",
		prefs: ["sync.focusRefetch"],
	},
	{
		id: "freshness",
		section: "sync",
		card: "Checking for mail",
		label: "How Often to Check",
		description: "Live checks most often. Saver checks less, to save data and battery.",
		keywords: "freshness frequency sync interval polling network battery data stale",
		prefs: ["sync.freshness"],
	},
	{
		id: "offline-cache",
		section: "sync",
		card: "On this device",
		label: "Save Mail on This Device",
		description: "Keep a copy of your inbox, folders and overview here, so Raven opens fast after a reload.",
		keywords: "offline cache storage indexeddb persist",
		prefs: ["sync.offlineCache"],
	},
	{
		id: "clear-cache",
		section: "sync",
		card: "On this device",
		label: "Clear Saved Mail",
		description: "Delete the copy on this device and download your mail again.",
		keywords: "local cache forget delete storage reset",
	},
	{
		id: "single-key",
		section: "keyboard",
		card: "Shortcuts",
		label: "One-Key Shortcuts",
		description: "Keys like C, J and / work without Ctrl or ⌘. Turn this off if you use a screen reader or press them by accident.",
		keywords: "single hotkeys character keys accessibility",
		prefs: ["keyboard.singleKey"],
	},
	{
		id: "shortcut-list",
		section: "keyboard",
		card: "Shortcuts",
		label: "All Shortcuts",
		keywords: "hotkeys keys keyboard list compose search next previous",
		stack: true,
	},
	{
		id: "tour-voice",
		section: "tour",
		card: "Narration",
		label: "Voice",
		description: "The accent that reads the tour. It's the same on all your devices.",
		keywords: "accent british american english gb us narrator speech tts",
	},
	{
		id: "tour-narration",
		section: "tour",
		card: "Narration",
		label: "Read Steps Aloud",
		description: "Turn this off to read the tour in silence. This only changes this device.",
		keywords: "mute sound audio narration voice speech",
		prefs: ["tour.narration"],
	},
	{
		id: "tour-replay",
		section: "tour",
		card: "Welcome Tour",
		label: "Take the Tour",
		description: "A short walk through Raven. It takes about a minute, and you can skip it anytime.",
		keywords: "onboarding intro guide walkthrough help replay restart resume",
	},
	{
		id: "identity",
		section: "account",
		card: "Signed in",
		label: "Mailbox",
		keywords: "email address provider account",
	},
	{
		id: "sign-out",
		section: "account",
		card: "Signed in",
		label: "Sign Out",
		description: "Sign out and remove your mail from this device.",
		keywords: "log out logout",
	},
	{
		id: "jev-key",
		section: "account",
		card: "Jev",
		label: "Your TypeSafe Key",
		description:
			"Use your own key for Ask Jev and Deep triage. It's kept encrypted with your sign-in on this device, and removed when you sign out.",
		keywords: "byok bring your own api key typesafe jev ai assistant ask triage",
		stack: true,
	},
	{
		id: "build",
		section: "about",
		card: "Raven",
		label: "Version",
		keywords: "build release",
	},
	{
		id: "whats-new",
		section: "about",
		card: "Raven",
		label: "What's New",
		description: "The latest changes to Raven.",
		keywords: "changelog release notes updates history",
		stack: true,
	},
	{
		id: "source",
		section: "about",
		card: "Raven",
		label: "Source Code",
		description: "Raven is open source under the AGPL-3.0 license.",
		keywords: "github repository open source license agpl code",
	},
	{
		id: "reset-all",
		section: "about",
		card: "Raven",
		label: "Reset All Settings",
		description: "Set every setting back to its default. Your theme and your mail stay as they are.",
		keywords: "defaults restore clear",
	},
];

export const SETTINGS_BY_ID = new Map(SETTINGS.map((s) => [s.id, s]));

export function sectionEntries(section: SectionId): SettingEntry[] {
	return SETTINGS.filter((s) => s.section === section);
}

export function sectionPrefs(section: SectionId): PrefKey[] {
	return sectionEntries(section).flatMap((s) => s.prefs ?? []);
}

/** Every word must appear somewhere in the row's label, description, keywords or section. */
export function searchSettings(query: string): SettingEntry[] {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return [];
	return SETTINGS.filter((s) => {
		const hay = `${s.label} ${s.description ?? ""} ${s.keywords ?? ""} ${SECTIONS[s.section].label}`.toLowerCase();
		return terms.every((t) => hay.includes(t));
	});
}

/** Splits `text` into plain and matched runs for <mark>. */
export function highlightParts(text: string, query: string): { text: string; match: boolean }[] {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return [{ text, match: false }];
	const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	const re = new RegExp(`(${escaped.join("|")})`, "gi");
	return text
		.split(re)
		.filter(Boolean)
		.map((part) => ({ text: part, match: terms.includes(part.toLowerCase()) }));
}
