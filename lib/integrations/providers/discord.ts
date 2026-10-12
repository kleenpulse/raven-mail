import { IntegrationError } from "../errors";
import { isLocalMock, json, judgeByStatus, parseHttpUrl, parseRetryAfter, truncate, type HttpResult, type Outbound } from "../http";
import type { BriefCard, EmailCard } from "../cards";
import type { ConnectionMeta } from "../types";
import { isDiscordHost, isSlackHost, type ProviderSpec, type Target } from "./shared";

const WEBHOOK_PATH = /^\/api(?:\/v\d+)?\/webhooks\/(\d{15,22})\/([\w-]{30,120})\/?$/;
const HINT = "Discord webhook URLs look like https://discord.com/api/webhooks/…/….";
const CORAL = 0xe8603c;

/** Inline markdown, masked links, mentions/timestamps, and line-start blocks. */
export function escapeDiscord(text: string): string {
	return text.replace(/[\\*_~`|[\]<]/g, "\\$&").replace(/^(\s*)([#>-]|\d+\.)/gm, "$1\\$2");
}

/** Pings nobody, whatever the email says (@everyone, <@id>, role mentions). */
const base = { username: "Raven", allowed_mentions: { parse: [] as string[] } };

function withWait(url: URL): URL {
	const next = new URL(url);
	next.searchParams.set("wait", "true");
	return next;
}

function post(target: Target, body: unknown): Outbound {
	return { method: "POST", url: withWait(target.url), ...json({ ...base, ...(body as object) }) };
}

function emailEmbed(card: EmailCard) {
	const description = [card.preview && escapeDiscord(card.preview), card.note && `**Note:** ${escapeDiscord(card.note)}`]
		.filter(Boolean)
		.join("\n\n");
	return {
		title: truncate(card.subject, 256),
		url: card.link,
		...(description ? { description: description.slice(0, 4000) } : {}),
		author: {
			name: truncate(card.fromAddress && card.fromAddress !== card.fromName ? `${card.fromName} · ${card.fromAddress}` : card.fromName, 256),
		},
		...(card.date ? { timestamp: card.date.toISOString() } : {}),
		color: CORAL,
		footer: { text: "Shared from Raven" },
	};
}

function briefEmbed(card: BriefCard) {
	return {
		title: truncate(`Daily brief · ${card.dateLabel}`, 256),
		url: card.link,
		color: CORAL,
		fields: card.items.map((item, i) => {
			const why = item.why.length ? ` · ${escapeDiscord(item.why.join(" · "))}` : "";
			return {
				name: truncate(`${i + 1}. ${item.subject}`, 256),
				value: `${truncate(`${escapeDiscord(item.fromName)}${why}`, 900)}\n[Open in Raven](${item.link})`,
			};
		}),
		footer: { text: "Sent from Raven" },
	};
}

type DiscordError = { code?: number; message?: string; retry_after?: number };

function readError(res: HttpResult): DiscordError {
	try {
		return JSON.parse(res.body) as DiscordError;
	} catch {
		return {};
	}
}

export function judgeDiscord(res: HttpResult): IntegrationError | null {
	if (res.status >= 200 && res.status < 300) return null;
	const body = readError(res);
	if (res.status === 404 || body.code === 10015 || body.code === 50027 || res.status === 401) {
		return new IntegrationError("revoked", {
			message: "Discord says this webhook no longer exists.",
			hint: "It was deleted or its token was reset. Create a new webhook in the channel's settings (Integrations → Webhooks) and reconnect.",
		});
	}
	if (res.status === 429) {
		const retryAfterMs = body.retry_after !== undefined ? Math.round(body.retry_after * 1000) : parseRetryAfter(res.headers["retry-after"]);
		return new IntegrationError("rate_limited", { message: "Discord is rate limiting this webhook.", retryAfterMs });
	}
	if (res.status === 400) {
		return new IntegrationError("payload_rejected", {
			message: `Discord rejected Raven's message${body.message ? ` (${body.message})` : ""}.`,
		});
	}
	return judgeByStatus(res);
}

/** GET on a webhook URL describes it (name, channel) without posting anything. */
export function discordLookup(target: Target): Outbound {
	return { method: "GET", url: target.url };
}

export function readDiscordLookup(res: HttpResult): ConnectionMeta {
	try {
		const hook = JSON.parse(res.body) as { name?: unknown; channel_id?: unknown; guild_id?: unknown };
		return {
			...(typeof hook.name === "string" ? { webhookName: truncate(hook.name, 80) } : {}),
			...(typeof hook.channel_id === "string" ? { channelId: hook.channel_id } : {}),
			...(typeof hook.guild_id === "string" ? { guildId: hook.guild_id } : {}),
		};
	} catch {
		throw new IntegrationError("unexpected_response", { message: "Discord's answer wasn't a webhook description." });
	}
}

export const discord: ProviderSpec = {
	kind: "discord",
	parse(raw, policy) {
		const url = parseHttpUrl(raw, policy);
		if (isSlackHost(url.hostname)) {
			throw new IntegrationError("wrong_provider_url", { hint: "That's a Slack webhook. Connect it from the Slack card." });
		}
		if (!isDiscordHost(url.hostname) && !isLocalMock(url, policy)) {
			throw new IntegrationError("invalid_url", { hint: HINT });
		}
		const match = url.pathname.match(WEBHOOK_PATH);
		if (!match) throw new IntegrationError("invalid_url", { hint: HINT });
		const [, id, token] = match as unknown as [string, string, string];

		// Canonical form; a forum/thread target is the only query worth keeping.
		const thread = url.searchParams.get("thread_id");
		const canonical = isLocalMock(url, policy) ? new URL(url.origin) : new URL("https://discord.com");
		canonical.pathname = `/api/webhooks/${id}/${token}`;
		if (thread && /^\d{15,22}$/.test(thread)) canonical.searchParams.set("thread_id", thread);

		return {
			url: canonical,
			hint: `discord.com/api/webhooks/${id.slice(0, 4)}…${id.slice(-4)}/••••`,
			meta: {},
			defaultLabel: "Discord channel",
			fingerprintKey: `discord:${id}/${token}${thread ? `?thread=${thread}` : ""}`,
		};
	},
	ping(target) {
		return post(target, {
			embeds: [
				{
					title: "Raven is connected",
					description: "Emails you share and your daily brief will show up in this channel.",
					color: CORAL,
				},
			],
		});
	},
	email(target, card) {
		return post(target, { embeds: [emailEmbed(card)] });
	},
	brief(target, card) {
		return post(target, { embeds: [briefEmbed(card)] });
	},
	judge: judgeDiscord,
};
