import type { IntegrationError } from "../errors";
import type { BriefCard, EmailCard } from "../cards";
import type { HttpResult, Outbound, UrlPolicy } from "../http";
import type { ConnectionKind, ConnectionMeta } from "../types";

export type ParsedTarget = {
	url: URL;
	/** Masked URL for display. */
	hint: string;
	meta: ConnectionMeta;
	defaultLabel: string;
	/** Canonical identity of the webhook, HMAC'd into the dedupe fingerprint. */
	fingerprintKey: string;
};

/** Everything needed to deliver; lives sealed in the DB between requests. */
export type Target = { url: URL; signingSecret?: string };

export type ProviderSpec = {
	kind: ConnectionKind;
	parse(raw: string, policy: UrlPolicy): ParsedTarget;
	ping(target: Target, label: string): Outbound;
	email(target: Target, card: EmailCard): Outbound;
	brief(target: Target, card: BriefCard): Outbound;
	judge(res: HttpResult): IntegrationError | null;
};

const DISCORD_HOSTS = new Set(["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"]);

export function isDiscordHost(host: string): boolean {
	return DISCORD_HOSTS.has(host.toLowerCase());
}

export function isSlackHost(host: string): boolean {
	return host.toLowerCase() === "hooks.slack.com";
}
