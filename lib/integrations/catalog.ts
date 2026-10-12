import type { CatalogId, ConnectionKind } from "./types";

export type CatalogEntry = {
	id: CatalogId;
	name: string;
	blurb: string;
	docsUrl?: string;
};

export const BUILT_IN: CatalogEntry[] = [
	{
		id: "mail",
		name: "Mail account",
		blurb: "The IMAP and SMTP connection behind every folder, search and send.",
	},
	{
		id: "jev",
		name: "Jev",
		blurb: "TypeSafe's decision model. Powers Ask Jev and Deep triage; heuristics fill in without it.",
		docsUrl: "https://docs.typesafe.ai",
	},
];

export type ChatEntry = CatalogEntry & {
	id: ConnectionKind;
	placeholder: string;
	labelPlaceholder: string;
	/** Where to get the URL, one short step per line. */
	howTo: string[];
};

export const CHAT: ChatEntry[] = [
	{
		id: "slack",
		name: "Slack",
		blurb: "Share an email into a channel, or post your daily brief.",
		docsUrl: "https://api.slack.com/messaging/webhooks",
		placeholder: "https://hooks.slack.com/services/T…/B…/…",
		labelPlaceholder: "#launch-room",
		howTo: [
			"In Slack, open api.slack.com/apps and create an app (or pick yours).",
			"Turn on Incoming Webhooks, then Add New Webhook to Workspace.",
			"Choose the channel and copy the webhook URL.",
		],
	},
	{
		id: "discord",
		name: "Discord",
		blurb: "Post shared emails and the brief to a server channel — mentions never ping.",
		docsUrl: "https://support.discord.com/hc/en-us/articles/228383668",
		placeholder: "https://discord.com/api/webhooks/…/…",
		labelPlaceholder: "Uses the webhook's name",
		howTo: [
			"Open the channel's settings → Integrations → Webhooks.",
			"Create a webhook and give it a name.",
			"Copy Webhook URL.",
		],
	},
	{
		id: "webhook",
		name: "Webhook",
		blurb: "Signed JSON for Zapier, Make, n8n or your own service.",
		docsUrl: "https://www.standardwebhooks.com",
		placeholder: "https://hooks.zapier.com/hooks/catch/…",
		labelPlaceholder: "Zapier → Notion",
		howTo: [
			"Create a “Catch hook” / webhook trigger in your automation tool.",
			"Paste its URL here. Raven sends a signed test ping.",
			"Verify deliveries with the signing secret (Standard Webhooks).",
		],
	},
];

export const EXPORT_ENTRY: CatalogEntry = {
	id: "export",
	name: "Mailbox export",
	blurb: "Download any folder as an .mbox file — opens in Thunderbird, Apple Mail or any archive tool.",
};

/** Not built yet. Token access exists for most — "soon", not "OAuth only". */
export const COMING_SOON = ["Google Calendar", "Notion", "Todoist", "Linear", "Asana", "Microsoft Teams"] as const;

export function catalogEntry(id: CatalogId): CatalogEntry {
	return [...BUILT_IN, ...CHAT, EXPORT_ENTRY].find((e) => e.id === id)!;
}

export function isCatalogId(value: string): value is CatalogId {
	return ["mail", "jev", "slack", "discord", "webhook", "export"].includes(value);
}
