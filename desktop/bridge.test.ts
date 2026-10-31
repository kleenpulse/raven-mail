import { describe, expect, test } from "bun:test";
import { MAX_ITEMS, MAX_TEXT, newMailNotice, openPath, parseNewMail, pathForNewMail, trustedSender } from "./bridge";

const item = (uid: string, from = "Ada", subject = "Hi") => ({ uid, from, subject });

describe("parseNewMail", () => {
	test("keeps well-formed items and drops extra fields", () => {
		expect(parseNewMail([{ ...item("42"), preview: "secret", html: "<b>" }])).toEqual([item("42")]);
	});

	test("caps sender and subject length", () => {
		const [parsed] = parseNewMail([item("1", "a".repeat(500), "b".repeat(500))])!;
		expect(parsed!.from.length).toBe(MAX_TEXT);
		expect(parsed!.subject.length).toBe(MAX_TEXT);
	});

	test("refuses the whole payload if one item is wrong", () => {
		for (const bad of [
			[item("0")],
			[item("-1")],
			[item("1.5")],
			[item("01")],
			[item("4294967296")],
			[{ uid: 7, from: "Ada", subject: "Hi" }],
			[{ uid: "7", from: 1, subject: "Hi" }],
			[{ uid: "7", from: "Ada" }],
			[item("7"), null],
			["7"],
		]) {
			expect(parseNewMail(bad)).toBeNull();
		}
	});

	test("refuses empty, oversized and non-array payloads", () => {
		expect(parseNewMail([])).toBeNull();
		expect(parseNewMail(Array.from({ length: MAX_ITEMS + 1 }, (_, i) => item(String(i + 1))))).toBeNull();
		expect(parseNewMail(Array.from({ length: MAX_ITEMS }, (_, i) => item(String(i + 1))))).toHaveLength(MAX_ITEMS);
		expect(parseNewMail({ uid: "1" })).toBeNull();
		expect(parseNewMail(undefined)).toBeNull();
	});
});

describe("trustedSender", () => {
	const app = "http://127.0.0.1:4100";

	test("only the app's own top frame", () => {
		expect(trustedSender({ origin: app, isTop: true }, app)).toBe(true);
		expect(trustedSender({ origin: app, isTop: false }, app)).toBe(false);
		expect(trustedSender({ origin: "null", isTop: false }, app)).toBe(false);
		expect(trustedSender({ origin: "https://evil.test", isTop: true }, app)).toBe(false);
		expect(trustedSender({ origin: "http://127.0.0.1:4101", isTop: true }, app)).toBe(false);
	});

	test("nothing before the server is up, or without a frame", () => {
		expect(trustedSender({ origin: app, isTop: true }, null)).toBe(false);
		expect(trustedSender(null, app)).toBe(false);
	});
});

describe("openPath", () => {
	test("lets the app's mail and overview paths through", () => {
		expect(openPath("/overview")).toBe("/overview");
		expect(openPath("/mail")).toBe("/mail");
		expect(openPath("/mail?folder=INBOX&uid=42")).toBe("/mail?folder=INBOX&uid=42");
		expect(openPath("/mail?mid=%3Ca%40b%3E")).toBe("/mail?mid=%3Ca%40b%3E");
		expect(openPath("/mail?compose=mailto%3Aa%40b.test")).toBe("/mail?compose=mailto%3Aa%40b.test");
	});

	test("drops other pages, keys and repeated keys", () => {
		for (const bad of ["/settings", "/api/mail/messages", "/overview?x=1", "/mail?folder=a&folder=b", "/mail?next=/settings", "/mail/", "/"]) {
			expect(openPath(bad)).toBeNull();
		}
	});

	test("drops anything that leaves the app or tidies into an allowed page", () => {
		for (const bad of [
			"https://evil.test/mail",
			"//evil.test/mail",
			"/\\evil.test",
			"mail",
			"javascript:alert(1)",
			"/settings/../mail",
			"/%2e%2e/mail",
			"/mail#top",
			"",
		]) {
			expect(openPath(bad)).toBeNull();
		}
	});
});

describe("notifications", () => {
	test("one message names its sender and opens it", () => {
		expect(newMailNotice([item("9", "Ada", "Lunch?")])).toEqual({ title: "Ada", body: "Lunch?" });
		expect(newMailNotice([item("9", "", "")])).toEqual({ title: "New message", body: "(no subject)" });
		expect(pathForNewMail([item("9")])).toBe("/mail?folder=INBOX&uid=9");
	});

	test("several are counted and open the inbox", () => {
		const items = [item("3", "Ada"), item("2", "Ada"), item("1", "Grace")];
		expect(newMailNotice(items)).toEqual({ title: "3 new messages", body: "Ada, Grace" });
		expect(pathForNewMail(items)).toBe("/mail");
		expect(openPath(pathForNewMail([item("9")]))).not.toBeNull();
	});
});
