"use client";

import * as React from "react";
import { EditorContent, Extension, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Code, Italic, Link2, List, ListOrdered, Quote, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { onlySignature } from "@/lib/mail/signature";
import { docToText, textToHtml } from "@/lib/mail/rich-text";

// ⌘/Ctrl+Enter sends (compose listens on the dock); StarterKit would insert a line break.
const SendKey = Extension.create({
	name: "sendKey",
	priority: 1000,
	addKeyboardShortcuts() {
		return { "Mod-Enter": () => true };
	},
});

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

function normalizeLink(raw: string): string | null {
	const href = raw.trim();
	if (!href) return null;
	if (SAFE_LINK.test(href)) return href;
	if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(href)) return `mailto:${href}`;
	if (/^[a-z][\w+.-]*:/i.test(href)) return null; // javascript:, data: and friends
	return `https://${href}`;
}

const TOOLS: { id: "bold" | "italic" | "bulletList" | "orderedList" | "blockquote" | "code"; label: string; keys?: string; icon: LucideIcon }[] = [
	{ id: "bold", label: "Bold", keys: "B", icon: Bold },
	{ id: "italic", label: "Italic", keys: "I", icon: Italic },
	{ id: "bulletList", label: "Bulleted list", icon: List },
	{ id: "orderedList", label: "Numbered list", icon: ListOrdered },
	{ id: "blockquote", label: "Quote", icon: Quote },
	{ id: "code", label: "Code", icon: Code },
];

function run(editor: Editor, id: (typeof TOOLS)[number]["id"]) {
	const chain = editor.chain().focus();
	if (id === "bold") chain.toggleBold().run();
	else if (id === "italic") chain.toggleItalic().run();
	else if (id === "bulletList") chain.toggleBulletList().run();
	else if (id === "orderedList") chain.toggleOrderedList().run();
	else if (id === "blockquote") chain.toggleBlockquote().run();
	else chain.toggleCode().run();
}

const toolClass = (on: boolean) =>
	cn(
		"grid size-8 place-items-center rounded-full text-ink-2 outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4",
		on && "bg-foreground/8 text-foreground dark:bg-accent",
	);

/**
 * The compose body: bold, italic, lists, links, quotes and code, with the
 * usual markdown shortcuts (**bold**, "- " for a list, "> " for a quote).
 * Loaded only when compose opens. It reports both the HTML and a plain-text
 * version, so every message goes out with a text part too.
 */
export function RichEditor({
	html,
	text,
	autoFocus,
	placeholder,
	mod,
	onChange,
}: {
	html?: string;
	text: string;
	autoFocus: boolean;
	placeholder: string;
	mod: string;
	onChange: (next: { html: string; text: string }) => void;
}) {
	const [linking, setLinking] = React.useState(false);
	const [href, setHref] = React.useState("");
	const report = (editor: Editor) => onChange({ html: editor.getHTML(), text: docToText(editor.getJSON()) });

	const editor = useEditor({
		immediatelyRender: false,
		extensions: [
			StarterKit.configure({
				heading: false,
				horizontalRule: false,
				strike: false,
				underline: false,
				link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["mailto"] },
			}),
			SendKey,
		],
		content: html || textToHtml(text),
		// Keeps the space in the "-- " signature line; mail clients look for exactly that.
		parseOptions: { preserveWhitespace: true },
		// Nothing typed above the signature yet: start above it.
		autofocus: autoFocus ? (onlySignature(text) ? "start" : "end") : false,
		editorProps: {
			attributes: {
				"aria-label": "Message body",
				"aria-multiline": "true",
				role: "textbox",
				"data-placeholder": placeholder,
			},
		},
		// A reopened draft's HTML passes through the editor's schema once, so what's sent is what's shown.
		onCreate: ({ editor }) => {
			if (html) report(editor);
		},
		onUpdate: ({ editor }) => report(editor),
	});

	const active = useEditorState({
		editor,
		selector: ({ editor: e }) =>
			e
				? {
						bold: e.isActive("bold"),
						italic: e.isActive("italic"),
						bulletList: e.isActive("bulletList"),
						orderedList: e.isActive("orderedList"),
						blockquote: e.isActive("blockquote"),
						code: e.isActive("code"),
						link: e.isActive("link"),
						empty: e.isEmpty,
					}
				: null,
	});

	function applyLink() {
		if (!editor) return;
		const url = normalizeLink(href);
		setLinking(false);
		setHref("");
		if (!url) {
			editor.commands.focus();
			return;
		}
		if (editor.state.selection.empty) {
			editor
				.chain()
				.focus()
				.insertContent({ type: "text", text: href.trim(), marks: [{ type: "link", attrs: { href: url } }] })
				.run();
		} else {
			editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
		}
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="relative min-h-0 flex-1">
				{active?.empty && (
					<p aria-hidden className="pointer-events-none absolute top-4 left-5 text-[14.5px] text-muted-foreground">
						{placeholder}
					</p>
				)}
				<EditorContent
					editor={editor}
					className={cn(
						"auto-scroll h-full overflow-y-auto px-5 py-4 text-[14.5px] leading-relaxed",
						"[&_.ProseMirror]:min-h-full [&_.ProseMirror]:outline-none [&_.ProseMirror]:whitespace-pre-wrap",
						"[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
						"[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-ink-2 dark:[&_blockquote]:border-glass-border",
						"[&_code]:rounded [&_code]:bg-card-nested [&_code]:px-1 [&_code]:font-mono [&_code]:text-[13px]",
						"[&_pre]:rounded-lg [&_pre]:bg-card-nested [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
						"[&_a]:text-signal-ink [&_a]:underline dark:[&_a]:text-signal",
					)}
				/>
			</div>
			<div role="toolbar" aria-label="Formatting" className="flex shrink-0 flex-wrap items-center gap-0.5 px-3 pb-1.5">
				{TOOLS.map(({ id, label, keys, icon: Icon }) => (
					<button
						key={id}
						type="button"
						aria-label={label}
						aria-pressed={Boolean(active?.[id])}
						title={keys ? `${label} (${mod}+${keys})` : label}
						disabled={!editor}
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => editor && run(editor, id)}
						className={toolClass(Boolean(active?.[id]))}
					>
						<Icon />
					</button>
				))}
				<button
					type="button"
					aria-label={active?.link ? "Remove link" : "Add link"}
					aria-pressed={Boolean(active?.link)}
					title={active?.link ? "Remove link" : "Add link"}
					disabled={!editor}
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => {
						if (!editor) return;
						if (active?.link) editor.chain().focus().extendMarkRange("link").unsetLink().run();
						else setLinking(true);
					}}
					className={toolClass(Boolean(active?.link))}
				>
					<Link2 />
				</button>
				{linking && (
					<input
						autoFocus
						type="url"
						inputMode="url"
						aria-label="Link address"
						placeholder="Paste a link, then Enter"
						value={href}
						onChange={(e) => setHref(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								applyLink();
							} else if (e.key === "Escape") {
								e.preventDefault();
								e.stopPropagation();
								setLinking(false);
								editor?.commands.focus();
							}
						}}
						onBlur={() => setLinking(false)}
						className="ml-1 h-8 min-w-0 flex-1 rounded-pill bg-card px-3 text-[13px] ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-card-nested dark:ring-glass-border"
					/>
				)}
			</div>
		</div>
	);
}
