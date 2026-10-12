import { IntegrationError } from "../errors";
import { isLocalMock, json, judgeByStatus, parseHttpUrl, truncate, type HttpResult } from "../http";
import type { BriefCard, EmailCard } from "../cards";
import { isDiscordHost, type ProviderSpec } from "./shared";

const SLACK_HOST = "hooks.slack.com";
const SERVICE_PATH = /^\/services\/(T[A-Z0-9]+)\/(B[A-Z0-9]+)\/([A-Za-z0-9]+)\/?$/;
const HINT = "Slack webhook URLs look like https://hooks.slack.com/services/T…/B…/….";

/** Slack mrkdwn: only these three need escaping (api.slack.com/reference/surfaces/formatting). */
export function escapeSlack(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const quote = (text: string) =>
	text
		.split("\n")
		.map((line) => `>${line}`)
		.join("\n");

/** Rendered in each reader's own time zone by Slack. */
function slackDate(date: Date): string {
	const unix = Math.floor(date.getTime() / 1000);
	return `<!date^${unix}^{date_short_pretty} at {time}|${date.toUTCString()}>`;
}

function emailBlocks(card: EmailCard) {
	const from = card.fromAddress && card.fromAddress !== card.fromName
		? `*${escapeSlack(card.fromName)}* · ${escapeSlack(card.fromAddress)}`
		: `*${escapeSlack(card.fromName)}*`;
	const when = card.date ? ` · ${slackDate(card.date)}` : "";
	return [
		{
			type: "section",
			text: { type: "mrkdwn", text: `*<${card.link}|${escapeSlack(card.subject)}>*\n${from}${when}` },
		},
		...(card.preview ? [{ type: "section", text: { type: "mrkdwn", text: quote(escapeSlack(card.preview)) } }] : []),
		...(card.note
			? [{ type: "section", text: { type: "mrkdwn", text: `_Note:_ ${escapeSlack(card.note)}` } }]
			: []),
		{
			type: "context",
			elements: [{ type: "mrkdwn", text: `Shared from Raven · <${card.link}|Open in Raven>` }],
		},
	];
}

function briefBlocks(card: BriefCard) {
	return [
		{ type: "header", text: { type: "plain_text", text: truncate(`Daily brief · ${card.dateLabel}`, 150) } },
		...card.items.map((item, i) => ({
			type: "section",
			text: {
				type: "mrkdwn",
				text:
					`*${i + 1}. <${item.link}|${escapeSlack(item.subject)}>*\n${escapeSlack(item.fromName)}` +
					(item.why.length ? ` · ${escapeSlack(item.why.join(" · "))}` : ""),
			},
		})),
		{ type: "context", elements: [{ type: "mrkdwn", text: `Sent from Raven · <${card.link}|Open overview>` }] },
	];
}

/** Slack answers webhooks with a plain-text reason; map the documented ones. */
export function judgeSlack(res: HttpResult): IntegrationError | null {
	if (res.status >= 200 && res.status < 300) return null;
	const reason = res.body.trim().slice(0, 80);
	switch (reason) {
		case "no_service":
		case "channel_not_found":
		case "invalid_token":
			return new IntegrationError("revoked", {
				message: "Slack says this webhook no longer exists.",
				hint: "Someone removed the webhook or its app. Create a new one in Slack (Apps → Incoming Webhooks) and reconnect.",
			});
		case "channel_is_archived":
			return new IntegrationError("archived", { message: "That Slack channel was archived." });
		case "action_prohibited":
		case "posting_to_general_channel_denied":
			return new IntegrationError("forbidden", {
				message: "A Slack admin blocked this webhook from posting.",
				hint: "Ask a workspace admin, or connect a webhook for another channel.",
			});
		case "invalid_payload":
		case "no_text":
		case "invalid_blocks":
		case "invalid_blocks_format":
		case "missing_text_or_fallback_or_attachments":
			return new IntegrationError("payload_rejected", { message: `Slack rejected Raven's message (${reason}).` });
		default:
			return judgeByStatus(res);
	}
}

export const slack: ProviderSpec = {
	kind: "slack",
	parse(raw, policy) {
		const url = parseHttpUrl(raw, policy);
		if (isDiscordHost(url.hostname)) {
			throw new IntegrationError("wrong_provider_url", { hint: "That's a Discord webhook. Connect it from the Discord card." });
		}
		if (url.hostname === SLACK_HOST && url.pathname.startsWith("/triggers/")) {
			throw new IntegrationError("wrong_provider_url", {
				message: "That's a Slack Workflow Builder trigger.",
				hint: "Workflow triggers take custom fields. Connect it as a generic webhook instead.",
			});
		}
		if (url.hostname !== SLACK_HOST && !isLocalMock(url, policy)) {
			throw new IntegrationError("invalid_url", { hint: HINT });
		}
		const match = url.pathname.match(SERVICE_PATH);
		if (!match) throw new IntegrationError("invalid_url", { hint: HINT });
		url.search = "";
		return {
			url,
			hint: `${url.host}/services/${match[1]}/${match[2]}/••••`,
			meta: {},
			defaultLabel: "Slack channel",
			fingerprintKey: `slack:${match[1]}/${match[2]}/${match[3]}`,
		};
	},
	ping(target) {
		return {
			method: "POST",
			url: target.url,
			...json({
				text: "Raven is connected. Emails you share will show up here.",
				blocks: [
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: "*Raven is connected.*\nEmails you share and your daily brief will show up in this channel.",
						},
					},
				],
			}),
		};
	},
	email(target, card) {
		return {
			method: "POST",
			url: target.url,
			...json({
				text: `${escapeSlack(card.subject)} — from ${escapeSlack(card.fromName)}`,
				blocks: emailBlocks(card),
				unfurl_links: false,
				unfurl_media: false,
			}),
		};
	},
	brief(target, card) {
		return {
			method: "POST",
			url: target.url,
			...json({
				text: `Daily brief · ${escapeSlack(card.dateLabel)}: ${card.items.length} ${card.items.length === 1 ? "email needs" : "emails need"} you`,
				blocks: briefBlocks(card),
				unfurl_links: false,
				unfurl_media: false,
			}),
		};
	},
	judge: judgeSlack,
};
