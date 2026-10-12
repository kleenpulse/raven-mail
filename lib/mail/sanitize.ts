import "server-only";
import sanitizeHtml from "sanitize-html";

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

/**
 * Output renders inside a sandboxed, script-less iframe with a CSP, so
 * presentational markup (classes, inline styles, <style>) is kept for fidelity;
 * scripts, handlers, forms and embeds are still stripped.
 */
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
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer",
        target: "_blank",
      }),
    },
  });
}

/** Whether the sanitized HTML would fetch anything remote (images, CSS). */
export function hasRemoteContent(html: string): boolean {
  return /\b(?:src|background)\s*=\s*["']?\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\/|@import/i.test(html);
}
