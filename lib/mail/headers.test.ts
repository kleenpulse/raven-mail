import { describe, expect, test } from "bun:test";
import {
	listHeaders,
	mailtoFields,
	parseDateHeader,
	parseHeaderBlock,
	parseListUnsubscribe,
	parseMailto,
	parseReferences,
	unsubscribeOptions,
} from "@/lib/mail/headers";

describe("parseHeaderBlock", () => {
	test("lowercases keys, trims values, keeps colons inside values", () => {
		const out = parseHeaderBlock("Subject: Re: hello\r\nX-Time:  10:30:00 \r\n");
		expect(Object.fromEntries(out)).toEqual({ subject: "Re: hello", "x-time": "10:30:00" });
	});

	test("unfolds continuation lines (CRLF or LF + space/tab)", () => {
		const out = parseHeaderBlock("References: <a@x>\r\n <b@x>\n\t<c@x>\r\nTo: a@x\n");
		expect(out.get("references")).toBe("<a@x> <b@x> <c@x>");
		expect(out.get("to")).toBe("a@x");
	});

	test("repeated headers are joined with ', '", () => {
		expect(parseHeaderBlock("Received: one\nReceived: two\nRECEIVED: three").get("received")).toBe("one, two, three");
	});

	test("skips lines without a name", () => {
		expect([...parseHeaderBlock("garbage line\n: no name\nX: 1").keys()]).toEqual(["x"]);
	});

	test("accepts bytes", () => {
		expect(parseHeaderBlock(new TextEncoder().encode("Subject: héllo\r\n")).get("subject")).toBe("héllo");
	});

	test.each([undefined, "", new Uint8Array()])("empty input %p → empty map", (raw) => {
		expect(parseHeaderBlock(raw).size).toBe(0);
	});
});

describe("parseDateHeader", () => {
	const epoch = Date.UTC(2003, 6, 1, 8, 52, 37);

	test.each([
		["Tue, 1 Jul 2003 10:52:37 +0200", 120],
		["Tue, 1 Jul 2003 10:52:37 +0200 (CEST)", 120],
		["Tue, 1 Jul 2003 04:22:37 -0430", -270],
		["Tue, 1 Jul 2003 14:37:37 +0545", 345],
		["Tue, 1 Jul 2003 08:52:37 +0000", 0],
		["Tue, 1 Jul 2003 08:52:37 GMT", 0],
		["Tue, 1 Jul 2003 08:52:37 UT", 0],
		["Tue, 1 Jul 2003 03:52:37 EST", -300],
		["Tue, 1 Jul 2003 04:52:37 EDT", -240],
		["Tue, 1 Jul 2003 01:52:37 PDT", -420],
		["Tue, 1 Jul 2003 00:52:37 PST", -480],
		["2003-07-01T14:22:37+05:30", 330],
	])("%p → offset %p", (value, offsetMin) => {
		expect(parseDateHeader(value)).toEqual({ epoch, offsetMin });
	});

	test("-0000 (unknown local zone) reads as zero offset", () => {
		const out = parseDateHeader("Tue, 1 Jul 2003 08:52:37 -0000");
		expect(out?.epoch).toBe(epoch);
		expect(out!.offsetMin + 0).toBe(0);
	});

	test("no zone at all → offset 0", () => {
		expect(parseDateHeader("Tue, 1 Jul 2003 08:52:37")?.offsetMin).toBe(0);
	});

	test.each([undefined, "", "not a date", "(comment only)"])("%p → null", (value) => {
		expect(parseDateHeader(value)).toBeNull();
	});
});

describe("parseListUnsubscribe", () => {
	test("first https and first mailto", () => {
		expect(
			parseListUnsubscribe(
				"<mailto:u@list.example?subject=unsub>, <https://list.example/u?id=1>, <https://second.example/u>, <mailto:b@x>",
			),
		).toEqual({ https: "https://list.example/u?id=1", mailto: "mailto:u@list.example?subject=unsub" });
	});

	test("only one kind present", () => {
		expect(parseListUnsubscribe("<https://x.example/u>")).toEqual({ https: "https://x.example/u", mailto: undefined });
		expect(parseListUnsubscribe("<MAILTO:u@x>")).toEqual({ https: undefined, mailto: "MAILTO:u@x" });
	});

	test("trims inside brackets and matches scheme case-insensitively", () => {
		expect(parseListUnsubscribe("< HTTPS://x.example/u >")?.https).toBe("HTTPS://x.example/u");
	});

	test.each([
		["undefined", undefined],
		["empty", ""],
		["plain http only (not one-click safe)", "<http://x.example/u>"],
		["no brackets", "https://x.example/u"],
		["javascript target", "<javascript:alert(1)>"],
	])("%s → undefined", (_, value) => {
		expect(parseListUnsubscribe(value)).toBeUndefined();
	});
});

describe("parseReferences", () => {
	test("extracts every <msg-id> in order", () => {
		expect(parseReferences("<a@x.com> <b@y.org>\r\n <c.d@z>")).toEqual(["<a@x.com>", "<b@y.org>", "<c.d@z>"]);
	});

	test("tolerates commas and junk between ids", () => {
		expect(parseReferences("junk <a@x>,<b@x> trailing")).toEqual(["<a@x>", "<b@x>"]);
	});

	test("skips bracketed text containing whitespace or nested brackets", () => {
		expect(parseReferences("<not an id> <<a@x>>")).toEqual(["<a@x>"]);
	});

	test.each([undefined, "", "no ids here"])("%p → []", (value) => {
		expect(parseReferences(value)).toEqual([]);
	});
});

describe("parseListUnsubscribe guards", () => {
	test("skips targets that don't parse or run too long", () => {
		const long = `https://x.example/${"a".repeat(2100)}`;
		expect(parseListUnsubscribe(`<${long}>, <https://ok.example/u>`)).toEqual({ https: "https://ok.example/u", mailto: undefined });
		expect(parseListUnsubscribe("<https://exa mple/u>")).toBeUndefined();
	});
});

describe("unsubscribeOptions", () => {
	const both = "<https://x.example/u/1>, <mailto:u@x.example?subject=stop>";

	test("one-click needs the exact List-Unsubscribe-Post value", () => {
		expect(unsubscribeOptions({ "list-unsubscribe": both, "list-unsubscribe-post": "List-Unsubscribe=One-Click" })).toEqual({
			https: "https://x.example/u/1",
			mailto: "mailto:u@x.example?subject=stop",
			oneClick: true,
		});
		expect(unsubscribeOptions({ "list-unsubscribe": both, "list-unsubscribe-post": " list-unsubscribe=one-click " })?.oneClick).toBe(true);
	});

	test.each([
		["no Post header", undefined],
		["another Post value", "List-Unsubscribe=Yes"],
		["a value with extras", "List-Unsubscribe=One-Click&evil=1"],
	])("%s → not one-click", (_, post) => {
		expect(unsubscribeOptions({ "list-unsubscribe": both, "list-unsubscribe-post": post })?.oneClick).toBe(false);
	});

	test("one-click is never offered on a mailto-only header", () => {
		expect(
			unsubscribeOptions({ "list-unsubscribe": "<mailto:u@x.example>", "list-unsubscribe-post": "List-Unsubscribe=One-Click" }),
		).toEqual({ https: undefined, mailto: "mailto:u@x.example", oneClick: false });
	});

	test("no usable target → undefined", () => {
		expect(unsubscribeOptions({})).toBeUndefined();
		expect(unsubscribeOptions({ "list-unsubscribe": "<http://x.example/u>" })).toBeUndefined();
	});
});

describe("parseMailto", () => {
	test("reads the address, subject and body", () => {
		expect(parseMailto("mailto:leave%2Bnews@x.example?subject=Remove%20me&body=please")).toEqual({
			to: "leave+news@x.example",
			subject: "Remove me",
			body: "please",
		});
	});

	test("falls back to 'unsubscribe' for a missing subject and body", () => {
		expect(parseMailto("mailto:u@x.example")).toEqual({ to: "u@x.example", subject: "unsubscribe", body: "unsubscribe" });
	});

	test.each([
		["not mailto", "https://x.example/u"],
		["no address", "mailto:?subject=x"],
		["bad escape", "mailto:%E0%A4%A@x.example"],
		["not a URL", "nope"],
	])("%s → undefined", (_, href) => {
		expect(parseMailto(href)).toBeUndefined();
	});
});

describe("mailtoFields", () => {
	test("a bare address", () => {
		expect(mailtoFields("mailto:reid@rides.co")).toEqual({ to: "reid@rides.co" });
	});

	test("every field, with extra recipients from the query", () => {
		expect(
			mailtoFields("MAILTO:a@x.example,b@x.example?to=c@x.example&CC=d@x.example&bcc=e@x.example&subject=Hi%20there&body=one%0D%0Atwo"),
		).toEqual({
			to: "a@x.example,b@x.example, c@x.example",
			cc: "d@x.example",
			bcc: "e@x.example",
			subject: "Hi there",
			body: "one\ntwo",
		});
	});

	test("a plus stays a plus", () => {
		expect(mailtoFields("mailto:a+tag@x.example?subject=1+1")).toEqual({ to: "a+tag@x.example", subject: "1+1" });
	});

	test("no address is still a draft", () => {
		expect(mailtoFields("mailto:?subject=x")).toEqual({ to: "", subject: "x" });
	});

	test.each(["https://x.example/u", "nope", "mailto:%E0%A4%A@x.example"])("%p → undefined", (href) => {
		expect(mailtoFields(href)).toBeUndefined();
	});
});

describe("listHeaders", () => {
	test("reads raw List-* values from mailparser's header lines, unfolded", () => {
		const lines = [
			{ key: "from", line: "From: a@x.example" },
			{ key: "list-unsubscribe", line: "List-Unsubscribe: <https://x.example/u/1>,\r\n <mailto:u@x.example>" },
			{ key: "list-unsubscribe-post", line: "List-Unsubscribe-Post: List-Unsubscribe=One-Click" },
			{ key: "list-id", line: "List-ID: Weekly <x.list>" },
		];
		expect(listHeaders(lines)).toEqual({
			"list-unsubscribe": "<https://x.example/u/1>, <mailto:u@x.example>",
			"list-unsubscribe-post": "List-Unsubscribe=One-Click",
			"list-id": "Weekly <x.list>",
		});
	});

	test("nothing in, nothing out", () => {
		expect(listHeaders(undefined)).toEqual({});
	});
});
