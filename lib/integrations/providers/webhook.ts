import { IntegrationError } from "../errors";
import { json, judgeByStatus, maskUrl, parseHttpUrl, type HttpResult, type Outbound } from "../http";
import { signedHeaders } from "../signing";
import type { BriefCard, EmailCard } from "../cards";
import { isDiscordHost, isSlackHost, type ProviderSpec, type Target } from "./shared";

const SERVICES: [RegExp, string][] = [
	[/(^|\.)zapier\.com$/, "Zapier"],
	[/(^|\.)make\.com$|(^|\.)integromat\.com$/, "Make"],
	[/(^|\.)pipedream\.net$/, "Pipedream"],
	[/(^|\.)ifttt\.com$/, "IFTTT"],
	[/(^|\.)n8n\.cloud$/, "n8n"],
];

/** Friendly name for well-known automation hosts (label + card hint). */
export function detectService(url: URL): string | undefined {
	const host = url.hostname.toLowerCase();
	for (const [pattern, name] of SERVICES) if (pattern.test(host)) return name;
	if (/\/webhook(-test)?\//.test(url.pathname)) return "n8n";
	return undefined;
}

type Event = { type: string; data: unknown };

function send(target: Target, event: Event, now: () => number): Outbound {
	const payload = json({ type: event.type, timestamp: new Date(now()).toISOString(), data: event.data });
	return {
		method: "POST",
		url: target.url,
		headers: {
			...payload.headers,
			"user-agent": "Raven-Webhooks/1.0",
			...signedHeaders(target.signingSecret, payload.body, now),
		},
		body: payload.body,
	};
}

export function emailEvent(card: EmailCard): Event {
	return {
		type: "email.shared",
		data: {
			email: {
				subject: card.subject,
				from: { name: card.fromName, address: card.fromAddress },
				date: card.date?.toISOString() ?? null,
				preview: card.preview,
				messageId: card.messageId ?? null,
				link: card.link,
			},
			note: card.note ?? null,
		},
	};
}

export function briefEvent(card: BriefCard): Event {
	return {
		type: "brief.sent",
		data: {
			date: card.dateLabel,
			link: card.link,
			items: card.items.map((item) => ({
				subject: item.subject,
				from: { name: item.fromName, address: item.fromAddress },
				why: item.why,
				link: item.link,
			})),
		},
	};
}

export function judgeWebhook(res: HttpResult): IntegrationError | null {
	if (res.status === 410) {
		// Standard Webhooks: 410 Gone means "stop sending here".
		return new IntegrationError("revoked", {
			message: "The receiver asked Raven to stop sending (410 Gone).",
			hint: "Reconnect with a new URL if you still want deliveries.",
		});
	}
	if (res.status === 404) {
		return new IntegrationError("revoked", {
			message: "The receiver says this URL doesn't exist.",
			hint: "The workflow may have been deleted or turned off. Check it, then reconnect.",
		});
	}
	return judgeByStatus(res);
}

/** `now` is injectable so signatures are reproducible in tests. */
export function createWebhookProvider(now: () => number = Date.now): ProviderSpec {
	return {
		kind: "webhook",
		parse(raw, policy) {
			const url = parseHttpUrl(raw, policy);
			if (isSlackHost(url.hostname) && url.pathname.startsWith("/services/")) {
				throw new IntegrationError("wrong_provider_url", {
					hint: "That's a Slack webhook. Connect it from the Slack card so messages are formatted for Slack.",
				});
			}
			if (isDiscordHost(url.hostname)) {
				throw new IntegrationError("wrong_provider_url", {
					hint: "That's a Discord webhook. Connect it from the Discord card so messages are formatted for Discord.",
				});
			}
			const service = detectService(url);
			return {
				url,
				hint: maskUrl(url),
				meta: service ? { service } : {},
				defaultLabel: service ?? url.hostname,
				fingerprintKey: `webhook:${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, "")}${url.search}`,
			};
		},
		ping(target, label) {
			return send(target, { type: "raven.ping", data: { message: "Raven is connected.", connection: label } }, now);
		},
		email(target, card) {
			return send(target, emailEvent(card), now);
		},
		brief(target, card) {
			return send(target, briefEvent(card), now);
		},
		judge: judgeWebhook,
	};
}

export const webhook = createWebhookProvider();
