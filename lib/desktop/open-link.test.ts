import { describe, expect, test } from "bun:test";
import { bounceTarget, webPath } from "./open-link";

describe("bounceTarget", () => {
	test.each([
		"raven://open/overview",
		"raven://open/overview/",
		"raven://open/mail",
		"raven://open/mail?folder=INBOX&uid=7",
		"raven://open/mail?folder=Work%2FClients&uid=42&mid=%3Ca%40b.example%3E",
	])("passes on %p", (to) => {
		expect(bounceTarget(to)).toBe(to);
	});

	test.each([
		null,
		"",
		"raven://evil",
		"raven://open/settings",
		"raven://open/../settings",
		"raven://open/mail#x",
		"raven://open/mail?x=1 y",
		"RAVEN://open/mail",
		"mailto:a@x.example",
		"javascript:alert(1)",
		"https://evil.test/",
		`raven://open/mail?folder=${"a".repeat(5000)}`,
	])("drops %p", (to) => {
		expect(bounceTarget(to)).toBeNull();
	});
});

describe("webPath", () => {
	test("the same page in the web app", () => {
		expect(webPath("raven://open/mail?folder=INBOX&uid=7")).toBe("/mail?folder=INBOX&uid=7");
		expect(webPath("raven://open/overview/")).toBe("/overview");
		expect(webPath("raven://open/mail/?uid=1")).toBe("/mail?uid=1");
	});
});
