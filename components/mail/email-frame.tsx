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

export type FrameLook = { designed: boolean; dark: boolean };

// Mirrors the Ember / Nebula tokens in globals.css — the srcdoc can't read the app's CSS variables.
const SKIN = {
	light: { fg: "#111111", muted: "#6b6b6b", link: "#b4461f", rule: "#e6e6e1" },
	dark: { fg: "#eaf2f1", muted: "#9fb3b1", link: "#e6c27a", rule: "rgba(160,220,215,.14)" },
} as const;

function lookStyles({ designed, dark }: FrameLook): string {
	if (designed) {
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

function buildDocument(html: string, allowRemote: boolean, look: FrameLook): string {
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
${lookStyles(look)}
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
	const { designed, dark } = look;
	const srcDoc = React.useMemo(
		() => buildDocument(html, allowRemote, { designed, dark }),
		[html, allowRemote, designed, dark],
	);

	React.useEffect(() => {
		const frame = ref.current;
		if (!frame) return;
		let observer: ResizeObserver | null = null;
		let win: Window | null = null;

		function forwardKey(e: KeyboardEvent) {
			if (e.metaKey || e.ctrlKey || e.altKey || !FORWARDED_KEYS.has(e.key)) return;
			window.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, code: e.code, shiftKey: e.shiftKey }));
		}

		function onLoad() {
			const doc = frame?.contentDocument;
			if (!doc) return;
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

		frame.addEventListener("load", onLoad);
		// srcdoc can finish loading before this effect attaches the listener.
		if (frame.contentDocument?.readyState === "complete") onLoad();
		return () => {
			frame.removeEventListener("load", onLoad);
			observer?.disconnect();
			win?.removeEventListener("keydown", forwardKey);
		};
	}, []);

	return (
		<iframe
			ref={ref}
			title={title}
			srcDoc={srcDoc}
			sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
			referrerPolicy="no-referrer"
			className={cn("block w-full overflow-hidden rounded-[inherit] border-0 bg-transparent", className)}
			style={{ height }}
		/>
	);
}
