"use client";

import * as React from "react";
import {
	COLLAPSE_SLOP,
	LIST_MAX,
	LIST_MIN,
	clampListWidth,
	type MailLayout,
} from "@/lib/mail/reader-layout";
import { cn } from "@/lib/utils";
import { uiZoom } from "@/lib/prefs/dom";

const NUDGE = 16;

type Drag = {
	pointerId: number;
	x: number;
	width: number;
	container: number;
	zoom: number;
	live: number | null;
	wide: boolean;
};

/**
 * The seam between list and reader (md+). Dragging writes the list's width
 * straight to its CSS var — no React render per frame — and commits on
 * release. Drag past the minimum and the list collapses into the wide view;
 * drag back out to restore it. Pointer capture keeps the drag alive over the
 * email iframe, which would otherwise swallow pointermove.
 */
export function ListSplitter({
	listRef,
	listId,
	layout,
	onLayout,
}: {
	listRef: React.RefObject<HTMLElement | null>;
	listId: string;
	layout: MailLayout;
	onLayout: React.Dispatch<React.SetStateAction<MailLayout>>;
}) {
	const drag = React.useRef<Drag | null>(null);
	const [dragging, setDragging] = React.useState(false);

	/** In CSS px of the (possibly zoomed) layout, like `--list-w`. */
	function measure() {
		const list = listRef.current;
		const zoom = uiZoom();
		const container = (list?.parentElement?.getBoundingClientRect().width ?? 0) / zoom;
		const width = layout.wide || !list ? 0 : list.getBoundingClientRect().width / zoom;
		return { container, width, zoom };
	}

	function setLive(width: number) {
		listRef.current?.style.setProperty("--list-w", `${width}px`);
	}

	function end(e: React.PointerEvent<HTMLDivElement>) {
		const d = drag.current;
		if (!d || d.pointerId !== e.pointerId) return;
		drag.current = null;
		setDragging(false);
		document.body.classList.remove("select-none", "cursor-col-resize");
		if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
		if (d.live !== null && !d.wide) {
			const width = d.live;
			onLayout((l) => ({ ...l, listWidth: width }));
		}
	}

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-controls={listId}
			aria-label="Resize message list"
			aria-valuemin={0}
			aria-valuemax={LIST_MAX}
			aria-valuenow={layout.wide ? 0 : (layout.listWidth ?? undefined)}
			aria-valuetext={layout.wide ? "Message list hidden" : undefined}
			title="Drag to resize · double-click to reset"
			tabIndex={0}
			data-dragging={dragging}
			className="group relative z-20 hidden w-0 shrink-0 touch-none outline-none md:block"
			onPointerDown={(e) => {
				if (e.button !== 0) return;
				e.preventDefault();
				const { container, width, zoom } = measure();
				drag.current = { pointerId: e.pointerId, x: e.clientX, width, container, zoom, live: null, wide: layout.wide };
				e.currentTarget.setPointerCapture(e.pointerId);
				setDragging(true);
				document.body.classList.add("select-none", "cursor-col-resize");
			}}
			onPointerMove={(e) => {
				const d = drag.current;
				if (!d || d.pointerId !== e.pointerId) return;
				const raw = d.width + (e.clientX - d.x) / d.zoom;
				const collapse = raw < LIST_MIN - COLLAPSE_SLOP;
				if (collapse) {
					if (!d.wide) {
						d.wide = true;
						onLayout((l) => ({ ...l, wide: true }));
					}
					return;
				}
				const width = clampListWidth(raw, d.container);
				const first = d.live === null;
				d.live = width;
				setLive(width);
				// Leaving the wide view, or the first move off the responsive default,
				// needs a render to switch the list onto the var; later moves don't.
				if (d.wide || (first && layout.listWidth === null)) {
					d.wide = false;
					onLayout((l) => ({ ...l, wide: false, listWidth: width }));
				}
			}}
			onPointerUp={end}
			onPointerCancel={end}
			onLostPointerCapture={end}
			onDoubleClick={() => onLayout({ listWidth: null, wide: false })}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					onLayout((l) => ({ ...l, wide: !l.wide }));
					return;
				}
				if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
				e.preventDefault();
				const { container, width } = measure();
				if (layout.wide) {
					if (e.key === "ArrowRight") onLayout((l) => ({ ...l, wide: false }));
					return;
				}
				const next = width + (e.key === "ArrowRight" ? NUDGE : -NUDGE);
				if (next < LIST_MIN) onLayout((l) => ({ ...l, wide: true }));
				else onLayout((l) => ({ ...l, listWidth: clampListWidth(next, container) }));
			}}
		>
			<span aria-hidden className="absolute inset-y-0 -left-1.5 w-3 cursor-col-resize" />
			<span
				aria-hidden
				className={cn(
					"pointer-events-none absolute inset-y-0 -left-px w-0.5 bg-transparent transition-colors duration-150",
					"group-hover:bg-signal/40 group-focus-visible:bg-signal/60 group-data-[dragging=true]:bg-signal",
				)}
			/>
		</div>
	);
}
