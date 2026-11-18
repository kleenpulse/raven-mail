import "@/test/dom";
import { afterEach, describe, expect, test } from "bun:test";

const { Editor } = await import("@tiptap/react");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const { InlineImage } = await import("./inline-image");
const { pruneInline, usedCids } = await import("@/lib/mail/inline-images");
const { docToText } = await import("@/lib/mail/rich-text");

// The real node in a real editor, against the helpers that read its HTML tag by tag.

let editor: InstanceType<typeof Editor> | undefined;
const open = (content: string) => (editor = new Editor({ extensions: [StarterKit, InlineImage.configure({ source: null })], content }));

afterEach(() => {
	editor?.destroy();
	editor = undefined;
});

describe("the inline image node", () => {
	test("writes a tag the send path can read: cid, alt, width and a fluid style", () => {
		const html = open('<p>hello<img src="cid:zz@raven.mail" alt="shot.png" width="560"></p>').getHTML();
		expect(html).toContain('src="cid:zz@raven.mail"');
		expect(html).toContain('alt="shot.png"');
		expect(html).toContain('width="560"');
		expect([...usedCids(html)]).toEqual(["zz@raven.mail"]);
		expect(docToText(editor!.getJSON())).toBe("hello[image: shot.png]");
		expect(pruneInline(html, []).html).toBe("<p>hello</p>");
	});

	test("an alt from pasted HTML can't break the tag: '>' and quotes are taken out on the way in", () => {
		const html = open('<p>x<img src="cid:zz@raven.mail" alt="a &gt; b &quot;q&quot;" width="10"></p>').getHTML();
		// With the bytes gone the whole tag goes, and none of it is left behind as text.
		expect(pruneInline(html, []).html).toBe("<p>x</p>");
		expect(html).toContain('alt="a  b q"');
	});

	test("remote and data: images are not images to this editor", () => {
		const html = open('<p>x<img src="https://x.example/a.png" alt="remote"><img src="data:image/png;base64,AAAA"></p>').getHTML();
		expect(html).toBe("<p>x</p>");
	});
});
