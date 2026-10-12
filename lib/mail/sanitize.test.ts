import { describe, expect, test } from "bun:test";
import { hasRemoteContent, sanitizeBody } from "@/lib/mail/sanitize";

describe("sanitizeBody", () => {
	test("drops <script> with its contents", () => {
		expect(sanitizeBody(`<p>hi</p><script>alert(1)</script>`)).toBe("<p>hi</p>");
	});

	test("keeps <style> blocks for fidelity", () => {
		expect(sanitizeBody(`<style>p{color:red}</style><p>x</p>`)).toBe("<style>p{color:red}</style><p>x</p>");
	});

	test("a script after a closed <style> is still stripped", () => {
		expect(sanitizeBody(`<style></style><script>alert(1)</script></style>`)).toBe("<style></style>");
	});

	test.each([
		["iframe", `<iframe src="https://e.com">inner</iframe>`, "inner"],
		["form + controls", `<form action="https://e"><input name=a><button>b</button></form>`, "b"],
		["object", `<object data="x">o</object>`, "o"],
		["embed", `<embed src="x">`, ""],
		["svg with script", `<svg><script>x</script></svg>`, ""],
		["meta refresh", `<meta http-equiv="refresh" content="0;url=https://e">`, ""],
		["base", `<base href="https://e">`, ""],
		["link stylesheet", `<link rel="stylesheet" href="https://x">`, ""],
		["textarea", `<textarea>ta</textarea>`, ""],
	])("removes %s", (_, input, out) => {
		expect(sanitizeBody(input)).toBe(out);
	});

	test.each(["onclick", "onerror", "onload", "onmouseover", "ONCLICK"])("strips %s handlers", (attr) => {
		const out = sanitizeBody(`<p ${attr}="x()">a</p><img src="cid:a" ${attr}="x()">`);
		expect(out.toLowerCase()).not.toContain(attr.toLowerCase());
		expect(out).toContain("<p>a</p>");
	});

	test.each([
		"javascript:alert(1)",
		" JaVaScRiPt:alert(1)",
		"java&#x09;script:alert(1)",
		"vbscript:x",
		"data:text/html,<script>alert(1)</script>",
		"//evil.example/x",
	])("drops unsafe href %p", (href) => {
		const out = sanitizeBody(`<a href="${href}">x</a>`);
		expect(out).not.toContain("href");
		expect(out).toContain(">x</a>");
	});

	test.each(["https://x.com/a", "http://x.com", "mailto:a@b.c", "tel:+15550100", "cid:part1"])("keeps href %p", (href) => {
		expect(sanitizeBody(`<a href="${href}">x</a>`)).toContain(`href="${href}"`);
	});

	test("forces rel=noopener noreferrer and target=_blank, overriding the sender's", () => {
		const out = sanitizeBody(`<a href="https://x.com" target="_self" rel="opener">ok</a>`);
		expect(out).toContain(`target="_blank"`);
		expect(out).toContain(`rel="noopener noreferrer"`);
		expect(out).not.toContain("_self");
		expect(out).not.toContain(`"opener"`);
	});

	test("forces rel/target even on anchors without href", () => {
		expect(sanitizeBody("<a>n</a>")).toBe(`<a rel="noopener noreferrer" target="_blank">n</a>`);
	});

	test.each([
		["data:image/png;base64,AAA", true],
		["cid:abc", true],
		["https://a/y.png", true],
		["http://a/y.png", true],
		["//evil/x.png", false],
		["javascript:x", false],
	])("img src %p kept: %p", (src, kept) => {
		const out = sanitizeBody(`<img src="${src}">`);
		expect(out.includes(`src="${src}"`)).toBe(kept);
	});

	test("img keeps only its allow-listed attributes", () => {
		const out = sanitizeBody(`<img src="cid:a" alt="A" width="10" height="5" srcset="https://a/x 1x" loading="lazy" id="i">`);
		expect(out).toBe(`<img src="cid:a" alt="A" width="10" height="5" />`);
	});

	test("keeps layout attributes, drops ids, data-* and background", () => {
		const out = sanitizeBody(
			`<div style="color:red" class="c" id="i" data-x="1">s</div><table background="https://x/bg.png" bgcolor="#fff" cellpadding="0"><tr><td align="left">t</td></tr></table>`,
		);
		expect(out).toBe(
			`<div style="color:red" class="c">s</div><table bgcolor="#fff" cellpadding="0"><tr><td align="left">t</td></tr></table>`,
		);
	});

	test.each(["h1", "h2", "center", "u", "strike", "span", "p", "table", "blockquote", "ul", "li"])("keeps <%s>", (tag) => {
		expect(sanitizeBody(`<${tag}>x</${tag}>`)).toContain(`<${tag}>`);
	});

	test("keeps <font> with presentational attributes", () => {
		expect(sanitizeBody(`<font face="x" color="red" size="2">f</font>`)).toBe(`<font face="x" color="red" size="2">f</font>`);
	});

	test("escapes quotes inside attribute values", () => {
		expect(sanitizeBody(`<img src="cid:x" alt='a"b'>`)).toBe(`<img src="cid:x" alt="a&quot;b" />`);
	});

	test("empty input", () => {
		expect(sanitizeBody("")).toBe("");
	});
});

describe("hasRemoteContent", () => {
	test.each([
		`<img src="https://a/x.png">`,
		`<img src="http://a/x.png">`,
		`<img SRC = 'https://a/x.png'>`,
		`<img src=https://a/x.png>`,
		`<img src="//a/x.png">`,
		`<td background="https://a/bg.png">`,
		`<div style="background:url(https://a/x.png)">`,
		`<div style="background:url( 'https://a/x.png')">`,
		`<div style="background:url(//a/x.png)">`,
		`<style>@import "https://a/x.css";</style>`,
		`<style>@IMPORT url(x.css);</style>`,
	])("remote: %p", (html) => {
		expect(hasRemoteContent(html)).toBe(true);
	});

	test.each([
		`<img src="cid:abc">`,
		`<img src="data:image/png;base64,AAA">`,
		`<div style="background:url(data:image/png;base64,AAA)">`,
		`<div style="background:url(cid:bg)">`,
		`<a href="https://a/page">link</a>`,
		`<p>see https://a/x.png</p>`,
		``,
	])("local only: %p", (html) => {
		expect(hasRemoteContent(html)).toBe(false);
	});

	test("srcset is stripped by sanitizeBody, so it can't smuggle a remote fetch", () => {
		const html = sanitizeBody(`<img srcset="https://a/x.png 1x" src="cid:a">`);
		expect(html).not.toContain("srcset");
		expect(hasRemoteContent(html)).toBe(false);
	});

	test("protocol-relative img src is stripped by sanitizeBody", () => {
		expect(hasRemoteContent(sanitizeBody(`<img src="//evil/x.png">`))).toBe(false);
	});

	test("detects remote images that survive sanitizing", () => {
		expect(hasRemoteContent(sanitizeBody(`<p>a</p><img src="https://t.example/open.gif" width="1" height="1">`))).toBe(true);
		expect(hasRemoteContent(sanitizeBody(`<style>@import url(https://x/a.css);</style>`))).toBe(true);
	});

	// BUG: sanitizeBody re-serialises a double-quoted CSS url() in a style attribute as
	// `url(&quot;https://…&quot;)`; the regex in lib/mail/sanitize.ts:60 only allows a literal
	// quote after `url(`, so the "Remote images blocked" banner never shows for these mails.
	// (The frame's CSP still blocks the fetch; the user just can't opt in to loading them.)
	test.todo("BUG: detects double-quoted CSS url() after sanitizing (&quot; entity)", () => {
		const html = sanitizeBody(`<div style='background:url("https://x/a.png")'>s</div>`);
		expect(html).toContain("url(&quot;https://x/a.png&quot;)");
		expect(hasRemoteContent(html)).toBe(true);
	});
});
