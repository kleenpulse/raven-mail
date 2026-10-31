import { describe, expect, test } from "bun:test";
import { contentSecurityPolicy, withCsp } from "./csp";

const policy = contentSecurityPolicy();
const directive = (name: string) =>
	policy
		.split("; ")
		.find((part) => part.startsWith(`${name} `))
		?.split(" ")
		.slice(1);

describe("contentSecurityPolicy", () => {
	test("scripts, connections and plugins stay on the app's own origin", () => {
		expect(directive("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
		expect(directive("connect-src")).toEqual(["'self'"]);
		expect(directive("object-src")).toEqual(["'none'"]);
		expect(directive("base-uri")).toEqual(["'self'"]);
		expect(directive("form-action")).toEqual(["'self'"]);
		expect(directive("frame-ancestors")).toEqual(["'none'"]);
	});

	test("never allows eval or remote scripts", () => {
		expect(policy).not.toContain("unsafe-eval");
		expect(directive("script-src")).not.toContain("https:");
		expect(directive("default-src")).toEqual(["'self'"]);
	});

	test("lets email bodies show remote images, styles and fonts, and previews use blob:", () => {
		expect(directive("img-src")).toEqual(expect.arrayContaining(["data:", "blob:", "https:", "http:"]));
		expect(directive("style-src")).toEqual(expect.arrayContaining(["'unsafe-inline'", "https:"]));
		expect(directive("font-src")).toEqual(expect.arrayContaining(["data:", "https:"]));
		expect(directive("frame-src")).toEqual(["'self'", "blob:"]);
		expect(directive("media-src")).toEqual(["'self'", "blob:"]);
	});
});

describe("withCsp", () => {
	test("adds the header when there is none", () => {
		expect(withCsp({ "content-type": ["text/html"] }, "x")).toEqual({ "content-type": ["text/html"], "Content-Security-Policy": ["x"] });
		expect(withCsp(undefined, "x")).toEqual({ "Content-Security-Policy": ["x"] });
	});

	test("keeps a policy the response already has, whatever its casing", () => {
		const out = withCsp({ "content-security-policy": ["default-src 'none'; sandbox"] }, "x");
		expect(out).toEqual({ "content-security-policy": ["default-src 'none'; sandbox", "x"] });
	});

	test("doesn't change the headers it was given", () => {
		const headers = { "Content-Security-Policy": ["a"] };
		withCsp(headers, "x");
		expect(headers).toEqual({ "Content-Security-Policy": ["a"] });
	});
});
