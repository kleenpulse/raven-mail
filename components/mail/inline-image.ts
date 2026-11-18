import { mergeAttributes, Node } from "@tiptap/react";
import { plainName } from "@/lib/mail/inline-images";

/** Where an inline image's bytes come from: a URL the browser can show, or nothing yet. */
export type ImageSource = {
	get: (cid: string) => string | undefined;
	subscribe: (onChange: () => void) => () => void;
};

/** Wide enough for a mail reader's column; Outlook goes by this attribute, not by CSS. */
export const IMAGE_MAX_WIDTH = 560;

/**
 * An image in the compose body. The document only holds `cid:<id>`; the bytes
 * live with the message's files, so the HTML stays small. Only cid: images
 * parse: remote and data: images in pasted web content are dropped, as before.
 */
export const InlineImage = Node.create<{ source: ImageSource | null }>({
	name: "image",
	group: "inline",
	inline: true,
	atom: true,
	selectable: true,
	// Moving it by drag isn't handled yet: a dragged <img> can look like a dropped file.
	draggable: false,

	addOptions() {
		return { source: null };
	},

	addAttributes() {
		return {
			cid: {
				default: "",
				parseHTML: (el) => (el.getAttribute("src") ?? "").replace(/^cid:/, ""),
				renderHTML: (attrs) => ({ src: `cid:${attrs.cid}` }),
			},
			alt: {
				default: "",
				// Pasted HTML can carry any alt. The send path reads the tag as text, so no ">" or quote gets in.
				parseHTML: (el) => plainName(el.getAttribute("alt") ?? ""),
				renderHTML: (attrs) => ({ alt: attrs.alt }),
			},
			width: {
				default: null,
				parseHTML: (el) => {
					const width = Number.parseInt(el.getAttribute("width") ?? "", 10);
					return width > 0 ? width : null;
				},
				renderHTML: (attrs) => (attrs.width ? { width: attrs.width } : {}),
			},
		};
	},

	parseHTML() {
		return [{ tag: 'img[src^="cid:"]' }];
	},

	renderHTML({ HTMLAttributes }) {
		return ["img", mergeAttributes(HTMLAttributes, { style: "max-width:100%;height:auto" })];
	},

	addNodeView() {
		const source = this.options.source;
		return ({ node }) => {
			const cid = String(node.attrs.cid);
			const dom = document.createElement("span");
			dom.className = "inline-image";
			dom.contentEditable = "false";
			let stop: (() => void) | undefined;

			const show = () => {
				const url = source?.get(cid);
				if (!url) {
					// Bytes live in memory only: a reload, or a message brought back from another tab, has none.
					if (dom.dataset.missing !== "true") {
						dom.dataset.missing = "true";
						dom.textContent = "This image wasn't kept. Paste it again.";
					}
					return false;
				}
				delete dom.dataset.missing;
				const img = document.createElement("img");
				img.src = url;
				img.alt = String(node.attrs.alt ?? "");
				img.draggable = false;
				if (node.attrs.width) img.width = Number(node.attrs.width);
				dom.replaceChildren(img);
				return true;
			};

			// A reopened draft's files can land after the editor is up.
			if (!show()) {
				stop = source?.subscribe(() => {
					if (show()) {
						stop?.();
						stop = undefined;
					}
				});
			}

			return { dom, ignoreMutation: () => true, destroy: () => stop?.() };
		};
	},
});
