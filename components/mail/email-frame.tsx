"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const FORWARDED_KEYS = new Set(["j", "k", "u", "c", "g", "/", "Escape", "ArrowUp", "ArrowDown"]);

/**
 * Author-styled mail (newsletters, branded receipts) sets its own backgrounds or
 * colours and is only legible on the paper it was designed for. Everything else
 * — plain notes, replies, notifications — can take the app's skin.
 */
export function isDesignedEmail(html: string): boolean {
	return /\bbgcolor\s*=|\bbackground\s*=|background(?:-color|-image)?\s*:|(?:^|[\s;"'{])color\s*:|<font[^>]*\bcolor\s*=/i.test(html);
}

/** Mail that ships its own dark look, which beats anything we can do to it. */
export function hasNativeDark(html: string): boolean {
	return /prefers-color-scheme\s*:\s*dark|\[data-ogsc\]|color-scheme\s*:[^;"'}]*\bdark\b/i.test(html);
}

/**
 * - `themed`: plain mail in the app's skin.
 * - `paper`: designed mail on the light paper it was made for.
 * - `native`: designed mail with its own dark styles, switched on.
 * - `inverted`: designed mail turned dark by a filter, with images turned back.
 */
export type FrameMode = "themed" | "paper" | "native" | "inverted";
export type FrameLook = { designed: boolean; dark: boolean; forceDark: boolean };

export function frameMode(html: string, { designed, dark, forceDark }: FrameLook): FrameMode {
	if (!designed) return "themed";
	if (!dark || !forceDark) return "paper";
	return hasNativeDark(html) ? "native" : "inverted";
}

// Mirrors the Ember / Nebula tokens in globals.css — the srcdoc can't read the app's CSS variables.
const SKIN = {
	light: { fg: "#111111", muted: "#6b6b6b", link: "#b4461f", rule: "#e6e6e1" },
	dark: { fg: "#eaf2f1", muted: "#9fb3b1", link: "#e6c27a", rule: "rgba(160,220,215,.14)" },
} as const;

// invert(.9) maps white to #1a1a1a and black to #e6e6e6, softer than a full flip. Images get
// the exact reverse (invert, then contrast 1.25) so they land back on their own colours.
const DARKEN = "invert(.9) hue-rotate(180deg)";
const UNDARKEN = "invert(1) contrast(1.25) hue-rotate(180deg)";
const BACKDROPS = '[style*="background-image"],[style*="url("]';
const UNDARKEN_TARGETS = `img,video,${BACKDROPS}`;

function lookStyles(mode: FrameMode, dark: boolean): string {
	if (mode === "native") {
		return `:root{color-scheme:dark}html,body{background:#161c1c;color:${SKIN.dark.fg}}body{padding:28px 32px}`;
	}
	if (mode === "inverted") {
		// The filter sits on body: the root's background paints the canvas, which filters skip.
		return `:root{color-scheme:light}html{background:#1a1a1a}body{background:#fff;color:#1b1b1b;padding:28px 32px;filter:${DARKEN}}
a{color:#b4461f}blockquote{border-left-color:#e5e5e5;color:#5f5f5f}
:where(${UNDARKEN_TARGETS}){filter:${UNDARKEN}}
:where(${BACKDROPS}) :where(img,video){filter:none}
@media print{html{background:#fff}body,:where(${UNDARKEN_TARGETS}){filter:none}}`;
	}
	if (mode === "paper") {
		// Paper for designed mail; warm off-white in Nebula so it glows less against the teal.
		return `:root{color-scheme:light}html,body{background:${dark ? "#f4f2ee" : "#fff"};color:#1b1b1b}
body{padding:28px 32px}a{color:#b4461f}blockquote{border-left-color:#e5e5e5;color:#5f5f5f}`;
	}
	const c = dark ? SKIN.dark : SKIN.light;
	// Themed: transparent, app ink, body aligned under the sender's name (avatar 40 + gap 12).
	return `:root{color-scheme:${dark ? "dark" : "light"}}html,body{background:transparent;color:${c.fg}}
body{padding:18px 8px 22px 52px}@media (max-width:520px){body{padding:16px 0 20px}}
a{color:${c.link};text-underline-offset:2px}hr{border:0;border-top:1px solid ${c.rule}}
blockquote{border-left-color:${c.rule};color:${c.muted}}td,th{border-color:${c.rule}}`;
}

function buildDocument(html: string, allowRemote: boolean, mode: FrameMode, dark: boolean): string {
	const remote = allowRemote ? " https: http:" : "";
	const csp = [
		"default-src 'none'",
		`img-src data: cid:${remote}`,
		`style-src 'unsafe-inline'${remote}`,
		`font-src data:${remote}`,
		"media-src 'none'",
		"frame-src 'none'",
		"form-action 'none'",
	].join("; ");
	return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><base target="_blank"><style>
html,body{margin:0}
body{font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;word-break:break-word;overflow-wrap:anywhere}
img{max-width:100%;height:auto}
table{max-width:100%}
pre{white-space:pre-wrap}
blockquote{margin:12px 0;padding-left:14px;border-left:2px solid}
${lookStyles(mode, dark)}
</style></head><body>${html}</body></html>`;
}

/**
 * Email HTML lives in its own document: no scripts (sandbox without
 * allow-scripts), a CSP that blocks remote fetches until the reader opts in,
 * and no way to overlay or restyle the app around it.
 */
export function EmailFrame({
	html,
	allowRemote,
	look,
	title,
	className,
}: {
	html: string;
	allowRemote: boolean;
	look: FrameLook;
	title: string;
	className?: string;
}) {
	const ref = React.useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = React.useState(48);
	const { designed, dark, forceDark } = look;
	const mode = frameMode(html, { designed, dark, forceDark });
	const srcDoc = React.useMemo(() => buildDocument(html, allowRemote, mode, dark), [html, allowRemote, mode, dark]);

	const setupDoc = React.useRef<Document | null>(null);

	React.useEffect(() => {
		const frame = ref.current;
		if (!frame) return;
		let observer: ResizeObserver | null = null;
		let win: Window | null = null;
		let raf = 0;

		function forwardKey(e: KeyboardEvent) {
			if (e.metaKey || e.ctrlKey || e.altKey || !FORWARDED_KEYS.has(e.key)) return;
			window.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, code: e.code, shiftKey: e.shiftKey }));
		}

		function setup() {
			const doc = frame?.contentDocument;
			if (!doc?.body) return;
			setupDoc.current = doc;
			// Body box, not documentElement.scrollHeight — that never reports less than the
			// frame's current height, so a short note could never shrink it.
			const measure = () => {
				const root = doc.documentElement;
				const body = doc.body;
				// Fixed-width newsletters (600px tables) scale down to fit instead of clipping.
				// scrollWidth stops at the content's right edge, so the body's right padding is added
				// back; a couple of passes settle it since the body reflows at each zoom.
				body.style.zoom = "";
				let zoom = 1;
				for (let pass = 0; pass < 3 && root.scrollWidth > root.clientWidth + 1; pass++) {
					const padRight = parseFloat(getComputedStyle(body).paddingRight) * zoom;
					zoom = Math.max(0.5, zoom * (root.clientWidth / (root.scrollWidth + padRight)));
					body.style.zoom = String(zoom);
				}
				setHeight(Math.max(48, Math.ceil(body.getBoundingClientRect().height)));
			};
			measure();
			observer?.disconnect();
			observer = new ResizeObserver(measure);
			observer.observe(doc.body);
			win?.removeEventListener("keydown", forwardKey);
			win = frame?.contentWindow ?? null;
			win?.addEventListener("keydown", forwardKey);
		}

		// `load` waits for every remote image, so a newsletter would sit at the 48px
		// default with an inner scrollbar for seconds. Size it as soon as the new srcdoc
		// is parsed instead; the ResizeObserver follows images as they arrive.
		function waitForParse() {
			const doc = frame?.contentDocument;
			if (doc && doc !== setupDoc.current && doc.readyState !== "loading" && doc.URL === "about:srcdoc") setup();
			else raf = requestAnimationFrame(waitForParse);
		}
		waitForParse();
		frame.addEventListener("load", setup);
		return () => {
			cancelAnimationFrame(raf);
			frame.removeEventListener("load", setup);
			observer?.disconnect();
			win?.removeEventListener("keydown", forwardKey);
		};
	}, [srcDoc]);

	return (
		<iframe
			ref={ref}
			title={title}
			srcDoc={srcDoc}
			sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
			referrerPolicy="no-referrer"
			className={cn("block w-full overflow-hidden rounded-[inherit] border-0 bg-transparent", className)}
			// The mail's own prefers-color-scheme follows this, so dark-aware mail only goes dark when we want it.
			style={{ height, colorScheme: mode === "native" || (mode === "themed" && dark) ? "dark" : "light" }}
		/>
	);
}
