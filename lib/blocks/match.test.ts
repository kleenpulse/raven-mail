import { describe, expect, test } from "bun:test";
import { blockMatcher, canBlockDomain, senderDomain } from "@/lib/blocks/match";

describe("blockMatcher", () => {
	const match = blockMatcher([
		{ kind: "address", value: "bob@shop.example" },
		{ kind: "domain", value: "spam.example" },
	]);

	test("an address block matches that address only, any case", () => {
		expect(match("Bob@Shop.Example")?.value).toBe("bob@shop.example");
		expect(match(" bob@shop.example ")?.value).toBe("bob@shop.example");
		expect(match("alice@shop.example")).toBeUndefined();
	});

	test("a domain block covers the domain and its subdomains", () => {
		expect(match("x@spam.example")?.value).toBe("spam.example");
		expect(match("x@mail.eu.spam.example")?.value).toBe("spam.example");
	});

	test("a domain block never covers a look-alike or a parent", () => {
		expect(match("x@notspam.example")).toBeUndefined();
		expect(match("x@example")).toBeUndefined();
		expect(match("spam.example@other.example")).toBeUndefined();
	});

	test("nothing blocked, or no address: no match", () => {
		expect(blockMatcher([])("bob@shop.example")).toBeUndefined();
		expect(match("")).toBeUndefined();
		expect(match("not-an-address")).toBeUndefined();
	});
});

describe("canBlockDomain", () => {
	test("offered for a company domain", () => {
		expect(canBlockDomain("deals@shop.example", "me@home.example")).toBe(true);
	});

	test.each(["friend@gmail.com", "friend@Outlook.com", "friend@icloud.com", "friend@proton.me"])(
		"never for a shared provider: %s",
		(address) => {
			expect(canBlockDomain(address, "me@home.example")).toBe(false);
		},
	);

	test("never for your own domain", () => {
		expect(canBlockDomain("boss@work.example", "me@WORK.example")).toBe(false);
	});

	test("never without a dotted domain", () => {
		expect(canBlockDomain("root@localhost", "me@home.example")).toBe(false);
		expect(canBlockDomain("nobody", "me@home.example")).toBe(false);
	});

	test("senderDomain lowercases and takes the last @", () => {
		expect(senderDomain('"a@b"@Shop.Example')).toBe("shop.example");
		expect(senderDomain("none")).toBe("");
	});
});
