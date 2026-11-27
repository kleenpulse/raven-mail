import type { ComposeDraft } from "@/lib/mail/types";

export type DocNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: DocNode[];
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function textToHtml(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : "<p></p>"))
    .join("");
}

function inline(nodes: DocNode[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === "hardBreak") return "\n";
      if (n.type === "image") {
        const alt = typeof n.attrs?.alt === "string" ? n.attrs.alt : "";
        return alt ? `[image: ${alt}]` : "[image]";
      }
      const text = n.text ?? inline(n.content);
      const href = n.marks?.find((m) => m.type === "link")?.attrs?.href;
      return typeof href === "string" && href && href !== text ? `${text} <${href}>` : text;
    })
    .join("");
}

function prefix(lines: string[], first: string): string[] {
  const rest = " ".repeat(first.length);
  return lines.map((line, i) => (line ? (i === 0 ? first : rest) + line : line));
}

function lines(nodes: DocNode[] = []): string[] {
  return nodes.flatMap((node): string[] => {
    switch (node.type) {
      case "bulletList":
        return (node.content ?? []).flatMap((item) => prefix(lines(item.content), "- "));
      case "orderedList": {
        const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1;
        return (node.content ?? []).flatMap((item, i) => prefix(lines(item.content), `${start + i}. `));
      }
      case "blockquote":
        return lines(node.content).map((l) => (l ? `> ${l}` : ">"));
      case "horizontalRule":
        return ["---"];
      case "listItem":
        return lines(node.content);
      default:
        return inline(node.content).split("\n");
    }
  });
}

export function docToText(doc: DocNode): string {
  return lines(doc.content).join("\n");
}

export function draftHtml(draft: Pick<ComposeDraft, "html" | "quote">): string | undefined {
  const lead = draft.html?.replace(/(<p>(<br\s*\/?>)?<\/p>)+$/, "");
  if (!lead) return undefined;
  if (!draft.quote) return lead;
  const { kind, header, body } = draft.quote;
  const quoted = textToHtml(body);
  return kind === "reply"
    ? `${lead}<p>${escapeHtml(header)}</p><blockquote>${quoted}</blockquote>`
    : `${lead}<p>${escapeHtml(header)}</p>${quoted}`;
}
