import { describe, expect, test } from "bun:test";
import { Webhook } from "standardwebhooks";
import { briefCard, emailCard, webLinker } from "@/lib/integrations/cards";
import { IntegrationError } from "@/lib/integrations/errors";
import type { HttpResult, UrlPolicy } from "@/lib/integrations/http";
import { discord, escapeDiscord, judgeDiscord, readDiscordLookup } from "@/lib/integrations/providers/discord";
import { escapeSlack, judgeSlack, slack } from "@/lib/integrations/providers/slack";
import { createWebhookProvider, detectService, judgeWebhook } from "@/lib/integrations/providers/webhook";
import { newSigningSecret } from "@/lib/integrations/signing";

const prod: UrlPolicy = { allowLoopback: false, allowPrivate: false };
const dev: UrlPolicy = { allowLoopback: true, allowPrivate: true };
const res = (status: number, body = "", headers: Record<string, string> = {}): HttpResult => ({ status, body, headers, ms: 12 });

function code(fn: () => unknown): string | undefined {
	try {
		fn();
	} catch (err) {
		return err instanceof IntegrationError ? err.code : "other";
	}
	return undefined;
}

const SLACK_URL = "https://hooks.slack.com/services/T0ABC123/B0DEF456/aBcDeFgHiJkLmNoPqRsTuVwX";
const DISCORD_URL =
	"https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGHIJ_-0123456789abcdefghijkl";

const email = emailCard(
	{
		folder: "INBOX",
		uid: "42",
		messageId: "<a@b>",
		subject: "Q3 <roadmap> & @everyone",
		from: { name: "Maya *Chen*", address: "maya@acme.io" },
		date: "2026-09-24T10:02:00.000Z",
		preview: "Line one\n\nFrom the team: see [this](https://evil.test) <@123>",
	},
	webLinker("https://mail.example.com"),
	"FYI — ping me",
);

describe("slack", () => {
	test("accepts incoming-webhook URLs and masks the token", () => {
		const parsed = slack.parse(SLACK_URL, prod);
		expect(parsed.hint).toBe("hooks.slack.com/services/T0ABC123/B0DEF456/••••");
		expect(parsed.url.toString()).toBe(SLACK_URL);
	});

	test("rejects look-alikes, workflow triggers, Discord URLs and plain http", () => {
		expect(code(() => slack.parse("https://hooks.slack.com.evil.io/services/T1/B2/x", prod))).toBe("invalid_url");
		expect(code(() => slack.parse("https://hooks.slack.com/triggers/T1/123/abc", prod))).toBe("wrong_provider_url");
		expect(code(() => slack.parse(DISCORD_URL, prod))).toBe("wrong_provider_url");
		expect(code(() => slack.parse(SLACK_URL.replace("https", "http"), prod))).toBe("insecure_url");
		expect(code(() => slack.parse("not a url", prod))).toBe("invalid_url");
	});

	test("local mock receivers only in development", () => {
		const mock = "http://127.0.0.1:4599/services/T1/B2/abc";
		expect(slack.parse(mock, dev).url.host).toBe("127.0.0.1:4599");
		expect(code(() => slack.parse(mock, prod))).toBe("private_address");
	});

	test("escapes mrkdwn control characters in email text", () => {
		expect(escapeSlack("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
		const body = JSON.parse(slack.email({ url: new URL(SLACK_URL) }, email).body!);
		const text = JSON.stringify(body.blocks);
		expect(text).toContain("Q3 &lt;roadmap&gt; &amp; @everyone");
		expect(text).toContain("https://mail.example.com/mail?folder=INBOX&uid=42&mid=%3Ca%40b%3E");
		expect(body.unfurl_links).toBe(false);
	});

	test("maps Slack's plain-text reasons", () => {
		expect(judgeSlack(res(200, "ok"))).toBeNull();
		expect(judgeSlack(res(404, "no_service"))?.code).toBe("revoked");
		expect(judgeSlack(res(410, "channel_is_archived"))?.code).toBe("archived");
		expect(judgeSlack(res(403, "posting_to_general_channel_denied"))?.code).toBe("forbidden");
		expect(judgeSlack(res(400, "invalid_blocks"))?.code).toBe("payload_rejected");
		expect(judgeSlack(res(429, "", { "retry-after": "2" }))?.retryAfterMs).toBe(2000);
		expect(judgeSlack(res(503, "oops"))?.retryable).toBe(true);
	});
});

describe("discord", () => {
	test("canonicalises host + api version, keeps only thread_id", () => {
		const parsed = discord.parse(
			DISCORD_URL.replace("discord.com/api", "discordapp.com/api/v10") + "?thread_id=123456789012345678&foo=1",
			prod,
		);
		expect(parsed.url.origin).toBe("https://discord.com");
		expect(parsed.url.pathname.startsWith("/api/webhooks/123456789012345678/")).toBe(true);
		expect(parsed.url.searchParams.get("thread_id")).toBe("123456789012345678");
		expect(parsed.url.searchParams.has("foo")).toBe(false);
		expect(parsed.hint).toBe("discord.com/api/webhooks/1234…5678/••••");
	});

	test("never pings anyone and escapes markdown", () => {
		const out = discord.email({ url: new URL(DISCORD_URL) }, email);
		expect(out.url.searchParams.get("wait")).toBe("true");
		const body = JSON.parse(out.body!);
		expect(body.allowed_mentions).toEqual({ parse: [] });
		expect(body.embeds[0].description).toContain("\\[this\\](https://evil.test) \\<@123>");
		expect(body.embeds[0].description).toContain("**Note:** FYI — ping me");
		expect(escapeDiscord("# Title\n- item *bold*")).toBe("\\# Title\n\\- item \\*bold\\*");
	});

	test("reads webhook lookups and error codes", () => {
		expect(readDiscordLookup(res(200, JSON.stringify({ name: "Raven", channel_id: "1", guild_id: "2" })))).toEqual({
			webhookName: "Raven",
			channelId: "1",
			guildId: "2",
		});
		expect(judgeDiscord(res(404, JSON.stringify({ code: 10015, message: "Unknown Webhook" })))?.code).toBe("revoked");
		expect(judgeDiscord(res(429, JSON.stringify({ retry_after: 1.5 })))?.retryAfterMs).toBe(1500);
		expect(judgeDiscord(res(400, JSON.stringify({ code: 50035, message: "Invalid Form Body" })))?.code).toBe(
			"payload_rejected",
		);
		expect(judgeDiscord(res(204))).toBeNull();
	});

	test("brief digest fits Discord's field limits", () => {
		const card = briefCard(
			{
				dateLabel: "Thu, Sep 24",
				items: Array.from({ length: 5 }, (_, i) => ({
					folder: "INBOX",
					uid: String(i + 1),
					subject: "x".repeat(300),
					from: { name: "N", address: "n@x.io" },
					why: ["Waiting 2 days", "VIP"],
				})),
			},
			webLinker("https://mail.example.com"),
		);
		const body = JSON.parse(discord.brief({ url: new URL(DISCORD_URL) }, card).body!);
		for (const field of body.embeds[0].fields) {
			expect(field.name.length).toBeLessThanOrEqual(256);
			expect(field.value.length).toBeLessThanOrEqual(1024);
		}
	});
});

describe("generic webhook", () => {
	test("routes Slack/Discord URLs to their own cards, keeps Slack workflow triggers", () => {
		const hook = createWebhookProvider();
		expect(code(() => hook.parse(SLACK_URL, prod))).toBe("wrong_provider_url");
		expect(code(() => hook.parse(DISCORD_URL, prod))).toBe("wrong_provider_url");
		expect(hook.parse("https://hooks.slack.com/triggers/T1/123/abc", prod).hint).toBe("hooks.slack.com/triggers/T1/••••");
	});

	test("recognises automation services", () => {
		expect(detectService(new URL("https://hooks.zapier.com/hooks/catch/1/abc/"))).toBe("Zapier");
		expect(detectService(new URL("https://hook.eu1.make.com/xyz"))).toBe("Make");
		expect(detectService(new URL("https://n8n.acme.io/webhook/abc"))).toBe("n8n");
		expect(detectService(new URL("https://api.acme.io/in"))).toBeUndefined();
	});

	test("signatures verify with the Standard Webhooks reference library", () => {
		const secret = newSigningSecret();
		const hook = createWebhookProvider(() => Date.now());
		const out = hook.email({ url: new URL("https://api.acme.io/in"), signingSecret: secret }, email);
		const verified = new Webhook(secret).verify(out.body!, out.headers!) as { type: string; data: { note: string } };
		expect(verified.type).toBe("email.shared");
		expect(verified.data.note).toBe("FYI — ping me");
	});

	test("tampered bodies fail verification; unsigned sends carry no signature", () => {
		const secret = newSigningSecret();
		const hook = createWebhookProvider();
		const out = hook.ping({ url: new URL("https://api.acme.io/in"), signingSecret: secret }, "Ops");
		expect(() => new Webhook(secret).verify(out.body!.replace("connected", "hacked"), out.headers!)).toThrow();
		const unsigned = hook.ping({ url: new URL("https://api.acme.io/in") }, "Ops");
		expect(unsigned.headers!["webhook-signature"]).toBeUndefined();
		expect(unsigned.headers!["webhook-id"]).toMatch(/^msg_/);
	});

	test("410 Gone disables, 404 flags, 5xx retries", () => {
		expect(judgeWebhook(res(410))?.code).toBe("revoked");
		expect(judgeWebhook(res(404))?.attention).toBe(true);
		expect(judgeWebhook(res(502))?.retryable).toBe(true);
		expect(judgeWebhook(res(302))?.code).toBe("redirect_blocked");
		expect(judgeWebhook(res(202))).toBeNull();
	});
});
