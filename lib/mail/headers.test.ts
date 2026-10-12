import { describe, expect, test } from "bun:test";
import { parseDateHeader, parseHeaderBlock, parseListUnsubscribe, parseReferences } from "@/lib/mail/headers";

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
