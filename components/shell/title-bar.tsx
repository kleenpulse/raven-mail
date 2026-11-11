"use client";

import * as React from "react";
import { Menu } from "lucide-react";
import { RAVEN_GLYPH } from "@/components/shell/raven-mark";
import { ravenDesktop } from "@/lib/desktop/bridge";

/** Window Controls Overlay (Chromium; not in TypeScript's DOM types yet). */
type ControlsOverlay = EventTarget & { readonly visible: boolean };

/**
 * The desktop window's title bar, drawn by the page the way VS Code draws its
 * own: the window has no system title bar, only its buttons over the top
 * right (Window Controls Overlay). This strip fills the rest, drags the
 * window, shows the page's title, and tells the desktop app its colours so
 * the buttons follow the theme.
 *
 * Its height is `--tb` (the overlay's height, from CSS env()), so on the web
 * and on macOS it is 0 tall and has nothing in it (app/globals.css).
 */
export function TitleBar() {
	const ref = React.useRef<HTMLDivElement>(null);
	const [overlay, setOverlay] = React.useState(false);
	const [title, setTitle] = React.useState("");

	React.useEffect(() => {
		const bar = ravenDesktop()?.titleBar;
		const wco = (navigator as Navigator & { windowControlsOverlay?: ControlsOverlay }).windowControlsOverlay;
		const el = ref.current;
		if (!bar || !wco || !el) return;
		// Full screen hides the overlay (and --tb drops to 0): the bar's contents go with it.
		const follow = () => setOverlay(wco.visible);
		follow();
		wco.addEventListener("geometrychange", follow);

		let sent = "";
		const send = () => {
			const style = getComputedStyle(el);
			const color = hex(style.backgroundColor, getComputedStyle(document.body).backgroundColor);
			const symbol = color && hex(style.color, color);
			if (!color || !symbol || `${color}${symbol}` === sent) return;
			sent = `${color}${symbol}`;
			bar.colors({ color, symbol });
		};
		send();
		// The theme (html.dark) and the app's own prefs change on the root element.
		const themes = new MutationObserver(send);
		themes.observe(document.documentElement, { attributes: true });

		const readTitle = () => setTitle(document.title);
		readTitle();
		const titles = new MutationObserver(readTitle);
		titles.observe(document.head, { childList: true, subtree: true, characterData: true });

		return () => {
			themes.disconnect();
			titles.disconnect();
			wco.removeEventListener("geometrychange", follow);
		};
	}, []);

	function openMenu(event: React.MouseEvent<HTMLButtonElement>) {
		const rect = event.currentTarget.getBoundingClientRect();
		ravenDesktop()?.titleBar?.menu({ x: rect.left, y: rect.bottom });
	}

	return (
		<div
			ref={ref}
			className="fixed inset-x-0 top-0 z-[70] flex h-(--tb) items-center overflow-hidden bg-background text-ink-2 select-none [app-region:drag]"
		>
			{overlay ? (
				<div className="flex h-full w-[env(titlebar-area-width,100%)] items-center gap-2 pl-[env(titlebar-area-x,0px)]">
					<button
						type="button"
						aria-label="Menu"
						title="Menu"
						onClick={openMenu}
						className="inline-flex h-full w-11 shrink-0 items-center justify-center transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:bg-foreground/10 focus-visible:outline-none [app-region:no-drag]"
					>
						<Menu className="size-4" aria-hidden />
					</button>
					<svg viewBox="0 0 24 24" className="size-4 shrink-0 text-foreground" fill="none" aria-hidden>
						<path d={RAVEN_GLYPH} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
						<circle cx="15.4" cy="9.1" r="1.4" className="fill-signal" />
					</svg>
					<span className="min-w-0 truncate font-mono text-[11px] tracking-wide">{title}</span>
				</div>
			) : null}
		</div>
	);
}

let canvas: CanvasRenderingContext2D | null = null;

/**
 * Any CSS colour (oklch, color-mix, with alpha) as `#rrggbb`, the only form
 * the desktop app takes: painted over `under` on a 1-pixel canvas and read back.
 */
function hex(css: string, under: string): string | null {
	canvas ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
	if (!canvas) return null;
	canvas.globalCompositeOperation = "source-over";
	canvas.fillStyle = under;
	canvas.fillRect(0, 0, 1, 1);
	canvas.fillStyle = css;
	canvas.fillRect(0, 0, 1, 1);
	const [r = 0, g = 0, b = 0] = canvas.getImageData(0, 0, 1, 1).data;
	return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}
