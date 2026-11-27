import "server-only";
import sanitizeHtml from "sanitize-html";
import { isAbsoluteMailLink } from "@/lib/mail/headers";

const LAYOUT_ATTRS = [
  "style",
  "class",
  "align",
  "valign",
  "dir",
  "width",
  "height",
  "bgcolor",
  "border",
  "cellpadding",
  "cellspacing",
  "color",
  "face",
  "size",
];

export function sanitizeBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "h1",
      "h2",
      "center",
      "font",
      "strike",
      "u",
      "span",
      "style",
    ]),
    allowVulnerableTags: true,
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      "*": LAYOUT_ATTRS,
      img: ["src", "alt", "width", "height", "border", "style"],
      a: ["href", "name", "target", "rel", "style", "class"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel", "cid"],
    allowedSchemesByTag: { img: ["http", "https", "cid", "data"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, { href, ...attribs }) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          ...(href !== undefined && isAbsoluteMailLink(href) ? { href } : {}),
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
    },
  });
}

export function hasRemoteContent(html: string): boolean {
  return /\b(?:src|background)\s*=\s*["']?\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\/|@import/i.test(html);
}
