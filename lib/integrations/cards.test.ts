import { afterEach, describe, expect, test } from "bun:test";
import { briefCard, desktopLinker, emailCard, webLinker } from "./cards";
import { slack } from "./providers/slack";
import { discord } from "./providers/discord";
import { createWebhookProvider } from "./providers/webhook";
import { cardLinker } from "./service";

const SHARED = {
	folder: "Work/Clients",
	uid: "42",
	messageId: "<a@b.example>",
	subject: "Q3 plan",
	from: { name: "Maya", address: "maya@acme.io" },
	date: "2026-09-24T10:02:00.000Z",
	preview: "Hello",
};
const BRIEF = { dateLabel: "Thu, Sep 24", items: [{ folder: "INBOX", uid: "7", subject: "Hi", from: { name: "N", address: "n@x.io" }, why: ["VIP"] }] };
const MAIL_PATH = "/mail?folder=Work%2FClients&uid=42&mid=%3Ca%40b.example%3E";

describe("web cards", () => {
	test("link straight to the web app and carry no raven link", () => {
		const card = emailCard(SHARED, webLinker("https://mail.example.com"));
		expect(card.link).toBe(`https://mail.example.com${MAIL_PATH}`);
		expect(card.ravenLink).toBeUndefined();
		const brief = briefCard(BRIEF, webLinker("https://mail.example.com"));
		expect(brief.link).toBe("https://mail.example.com/overview");
		expect(brief.items[0]!.link).toBe("https://mail.example.com/mail?folder=INBOX&uid=7");
	});

	test("webhook JSON has no ravenLink", () => {
		const out = createWebhookProvider().email({ url: new URL("https://api.acme.io/in") }, emailCard(SHARED, webLinker("https://mail.example.com")));
		expect(JSON.parse(out.body!).data.email).not.toHaveProperty("ravenLink");
	});
});

describe("desktop cards", () => {
	const links = desktopLinker("https://raven-mail.vercel.app");
	const card = emailCard(SHARED, links);
	const brief = briefCard(BRIEF, links);

	test("link through the public /open page to the raven:// link", () => {
		expect(card.ravenLink).toBe(`raven://open${MAIL_PATH}`);
		expect(card.link).toBe(`https://raven-mail.vercel.app/open?to=${encodeURIComponent(`raven://open${MAIL_PATH}`)}`);
		expect(new URL(card.link).searchParams.get("to")).toBe(card.ravenLink!);
		expect(brief.ravenLink).toBe("raven://open/overview");
		expect(brief.items[0]!.ravenLink).toBe("raven://open/mail?folder=INBOX&uid=7");
	});

	test("Slack and Discord use the bounce link, never 127.0.0.1", () => {
		const slackBody = slack.email({ url: new URL("https://hooks.slack.com/services/T1/B2/x") }, card).body!;
		const discordBody = discord.brief({ url: new URL("https://discord.com/api/webhooks/1/x") }, brief).body!;
		for (const body of [slackBody, discordBody]) {
			expect(body).toContain("https://raven-mail.vercel.app/open?to=raven%3A%2F%2Fopen%2F");
			expect(body).not.toContain("127.0.0.1");
		}
	});

	test("webhook JSON carries the raw raven link too", () => {
		const hook = createWebhookProvider();
		const email = JSON.parse(hook.email({ url: new URL("https://api.acme.io/in") }, card).body!).data.email;
		expect(email.link).toBe(card.link);
		expect(email.ravenLink).toBe(card.ravenLink);
		const data = JSON.parse(hook.brief({ url: new URL("https://api.acme.io/in") }, brief).body!).data;
		expect(data.ravenLink).toBe("raven://open/overview");
		expect(data.items[0].ravenLink).toBe("raven://open/mail?folder=INBOX&uid=7");
	});
});

describe("cardLinker", () => {
	const saved = { build: process.env.RAVEN_DESKTOP_BUILD, base: process.env.RAVEN_LINK_BASE, app: process.env.APP_URL };
	const restore = (key: string, value: string | undefined) => {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	};
	afterEach(() => {
		restore("RAVEN_DESKTOP_BUILD", saved.build);
		restore("RAVEN_LINK_BASE", saved.base);
		restore("APP_URL", saved.app);
	});
	const request = new Request("http://127.0.0.1:52731/api/integrations/share", { headers: { host: "127.0.0.1:52731" } });

	test("the desktop build links through RAVEN_LINK_BASE", () => {
		process.env.RAVEN_DESKTOP_BUILD = "1";
		process.env.RAVEN_LINK_BASE = "https://raven-mail.vercel.app";
		expect(cardLinker(request)("/overview")).toEqual({ link: "https://raven-mail.vercel.app/open?to=raven%3A%2F%2Fopen%2Foverview", ravenLink: "raven://open/overview" });
	});

	test("the web build ignores RAVEN_LINK_BASE", () => {
		delete process.env.RAVEN_DESKTOP_BUILD;
		delete process.env.APP_URL;
		process.env.RAVEN_LINK_BASE = "https://raven-mail.vercel.app";
		expect(cardLinker(request)("/overview")).toEqual({ link: "http://127.0.0.1:52731/overview" });
	});
});
