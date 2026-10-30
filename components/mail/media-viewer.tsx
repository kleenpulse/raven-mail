"use client";

// Ported from Ellum's MediaModal (components/miscellaneous/image-modal.tsx): the
// grow-from-trigger box, zoom/pan, and gallery navigation. Raven changes:
// - Controlled. The attachment chips are the triggers; useAttachmentPreview owns
//   the items and their blob URLs, this only shows them.
// - The trigger is a text chip and the bytes aren't loaded yet, so the box waits
//   for the real size (img.decode / loadedmetadata) before it grows. If that takes
//   longer than GROW_WAIT_MS it grows into a 4:3 loading box. That box is the floor
//   for every file: it may grow to fit a wide or tall one, but never shrinks under it.
// - Closing shrinks into the chip of the item on screen, not the one that opened it.
// - Keys live on the panel's React onKeyDown, like GrowPanel: the shell closes the
//   open mail on a window-level Escape, and stopPropagation here runs first.

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, LoaderCircle, Minus, Plus, X } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { useMounted } from "@/hooks/use-mounted";
import { useOverlayBackClose } from "@/hooks/use-overlay-back-close";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { getCenteredRect, type Rect } from "@/lib/fit-rect";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

export type MediaItem = {
	key: string;
	filename: string;
	size: number;
	kind: "image" | "video";
	/** Null while the bytes load. */
	url: string | null;
	/** The bytes couldn't be fetched. */
	failed?: boolean;
	/** Where Download points when there is no blob URL (a failed fetch). */
	fallbackHref?: string;
};

type Size = { w: number; h: number };

const OPEN_MS = 360;
const CLOSE_MS = 280;
const OPEN_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const CLOSE_EASE = "cubic-bezier(0.4, 0, 1, 1)";
const GROW_WAIT_MS = 250;
const FALLBACK_RATIO = 4 / 3;
/** The least a small image's box fits to (the loading box is usually larger), and the start box with no chip. */
const MIN_BOX = 320;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
const DRAG_THRESHOLD_PX = 5;
const SWIPE_CLOSE_PX = 120;
const FOCUSABLE = 'button, [href], input, select, textarea, video[controls], [tabindex]:not([tabindex="-1"])';
/** Arrow keys belong to these when they have focus (a video's controls seek with them). */
const OWNS_ARROWS = "video, input, textarea, select, [role='slider']";

const boxTransition = (ms: number, ease: string) =>
	["top", "left", "width", "height", "transform", "opacity"].map((p) => `${p} ${ms}ms ${ease}`).join(", ");

function clampZoom(value: number) {
	return Math.round(Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM) * 100) / 100;
}

/** The real pixel size, null when the browser can't tell. Rejects when the file won't decode. */
function measure(url: string, kind: MediaItem["kind"]): Promise<Size | null> {
	if (kind === "image") {
		const img = new Image();
		img.src = url;
		return img
			.decode()
			.then(() => (img.naturalWidth > 0 && img.naturalHeight > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : null));
	}
	return new Promise((resolve, reject) => {
		const video = document.createElement("video");
		video.preload = "metadata";
		video.muted = true;
		const finish = () => {
			video.onloadedmetadata = null;
			video.onerror = null;
			video.removeAttribute("src");
			video.load();
		};
		video.onloadedmetadata = () => {
			const size = video.videoWidth > 0 && video.videoHeight > 0 ? { w: video.videoWidth, h: video.videoHeight } : null;
			finish();
			resolve(size);
		};
		video.onerror = () => {
			finish();
			reject(new Error("video metadata"));
		};
		video.src = url;
	});
}

function startBox(origin: DOMRect | null): React.CSSProperties {
	if (origin) {
		return {
			top: origin.top,
			left: origin.left,
			width: origin.width,
			height: origin.height,
			opacity: 0,
			transform: "scale(0.98)",
			transition: "none",
		};
	}
	const width = Math.min(MIN_BOX, window.innerWidth);
	const height = width / FALLBACK_RATIO;
	return {
		top: (window.innerHeight - height) / 2,
		left: (window.innerWidth - width) / 2,
		width,
		height,
		opacity: 0,
		transform: "scale(0.96)",
		transition: "none",
	};
}

const CHROME =
	"grid size-8 shrink-0 place-items-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35";
const NAV =
	"absolute top-1/2 z-20 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none";

export function MediaViewer({
	items,
	index,
	originRect,
	onIndexChange,
	getOrigin,
	onClosed,
}: {
	items: MediaItem[];
	index: number;
	/** The clicked chip's rect: the box grows out of it. */
	originRect: DOMRect | null;
	onIndexChange: (index: number) => void;
	/** The chip for an item, so closing can shrink into it and give it focus. */
	getOrigin: (key: string) => HTMLElement | null;
	/** The close animation has finished. */
	onClosed: () => void;
}) {
	const mounted = useMounted();
	const reduce = useReducedMotion();
	const active = items[index] ?? items[0]!;
	const count = items.length;

	const overlayRef = React.useRef<HTMLDivElement>(null);
	const panelRef = React.useRef<HTMLDivElement>(null);
	const stageRef = React.useRef<HTMLDivElement>(null);
	const videoRef = React.useRef<HTMLVideoElement>(null);
	const openerRef = React.useRef<HTMLElement | null>(null);
	const openKeyRef = React.useRef(active.key);
	const activeKeyRef = React.useRef(active.key);
	const sizesRef = React.useRef(new Map<string, Size | null>());
	const measuringRef = React.useRef(new Set<string>());
	const itemsRef = React.useRef(items);
	const grownRef = React.useRef(false);
	const closingRef = React.useRef(false);
	const animatingUntilRef = React.useRef(0);
	const closeTimerRef = React.useRef<number | null>(null);
	const dragRef = React.useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
	const pinchRef = React.useRef<{ distance: number; zoom: number; x: number; y: number } | null>(null);
	const swipeRef = React.useRef<{ x: number; y: number } | null>(null);
	const panRafRef = React.useRef<number | null>(null);

	const [box, setBox] = React.useState<React.CSSProperties>(() => startBox(originRect));
	const [closing, setClosing] = React.useState(false);
	const [zoom, setZoom] = React.useState(1);
	const [pan, setPan] = React.useState({ x: 0, y: 0 });
	const [dragging, setDragging] = React.useState(false);
	const [broken, setBroken] = React.useState<ReadonlySet<string>>(() => new Set());
	const [playing, setPlaying] = React.useState(false);

	React.useEffect(() => {
		activeKeyRef.current = active.key;
		itemsRef.current = items;
	}, [active.key, items]);

	// --- Box geometry -------------------------------------------------------

	/** The box `position: fixed` resolves against: our full-screen overlay, else the window. */
	const viewport = React.useCallback((): Rect => {
		const r = overlayRef.current?.getBoundingClientRect();
		if (r && r.width > 0) return { top: r.top, left: r.left, width: r.width, height: r.height };
		return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
	}, []);

	const boxFor = React.useCallback(
		(key: string): Rect => {
			const vp = viewport();
			const size = sizesRef.current.get(key) ?? null;
			// Phones go edge to edge; wider screens keep a gutter.
			const padding = vp.width < 640 ? 0 : Math.min(48, vp.width * 0.06, vp.height * 0.06);
			const fitTo = (aspectRatio: number) =>
				getCenteredRect({ viewportWidth: vp.width, viewportHeight: vp.height, aspectRatio, padding });
			// The box shown while the bytes load.
			const loading = fitTo(FALLBACK_RATIO);
			if (!size) return loading;
			const fit = fitTo(size.w / size.h);
			// A 64px icon at full screen only blurs: the image stays near its own size.
			const scale = Math.min(1, Math.max(size.w / fit.width, MIN_BOX / Math.max(fit.width, fit.height)));
			// The box itself never goes under the loading box, so it holds one size whether the
			// file was already here or arrived later, and stepping to a small file doesn't shrink it.
			// It may still grow to fit a wide or tall file.
			const width = Math.max(fit.width * scale, loading.width);
			const height = Math.max(fit.height * scale, loading.height);
			return { top: (vp.height - height) / 2, left: (vp.width - width) / 2, width, height };
		},
		[viewport],
	);

	const grow = React.useCallback(() => {
		if (grownRef.current || closingRef.current) return;
		grownRef.current = true;
		const target = boxFor(activeKeyRef.current);
		animatingUntilRef.current = performance.now() + OPEN_MS;
		setBox({
			...target,
			opacity: 1,
			transform: "scale(1)",
			transition: reduce ? "none" : boxTransition(OPEN_MS, OPEN_EASE),
		});
	}, [boxFor, reduce]);

	/** Re-fit to an item's shape: after its size arrives, on a step, on resize. */
	const refit = React.useCallback(
		(key: string, animate = true) => {
			if (!grownRef.current || closingRef.current) return;
			const target = boxFor(key);
			setBox((prev) => ({
				...prev,
				...target,
				transition: animate && !reduce ? boxTransition(OPEN_MS, OPEN_EASE) : "none",
			}));
		},
		[boxFor, reduce],
	);

	// Grow as soon as the size is known, or into the 4:3 box once waiting stops feeling instant.
	React.useEffect(() => {
		const timer = window.setTimeout(grow, GROW_WAIT_MS);
		return () => window.clearTimeout(timer);
	}, [grow]);

	// Measure every file whose bytes are here, neighbours too, so a step lands on the right shape.
	React.useEffect(() => {
		for (const { key, url, kind } of items) {
			if (!url || sizesRef.current.has(key) || measuringRef.current.has(key)) continue;
			measuringRef.current.add(key);
			const settle = (size: Size | null, ok: boolean) => {
				measuringRef.current.delete(key);
				// Released mid-measure (stepped too far away): its revoked URL proves nothing.
				if (itemsRef.current.find((item) => item.key === key)?.url !== url) return;
				sizesRef.current.set(key, size);
				if (!ok) setBroken((prev) => new Set(prev).add(key));
				if (activeKeyRef.current !== key) return;
				if (!grownRef.current) {
					grow();
					return;
				}
				refit(key);
			};
			measure(url, kind).then(
				(size) => settle(size, true),
				() => settle(null, false),
			);
		}
	}, [items, grow, refit]);

	React.useEffect(() => {
		const onResize = () => {
			if (performance.now() < animatingUntilRef.current) return;
			refit(activeKeyRef.current, false);
		};
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [refit]);

	// --- Open / close -------------------------------------------------------

	React.useEffect(() => {
		openerRef.current = document.activeElement as HTMLElement | null;
		panelRef.current?.focus({ preventScroll: true });
		document.body.classList.add("overflow-hidden");
		return () => {
			document.body.classList.remove("overflow-hidden");
			if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
			if (panRafRef.current) cancelAnimationFrame(panRafRef.current);
		};
	}, []);

	const close = React.useCallback(() => {
		if (closingRef.current) return;
		closingRef.current = true;
		setClosing(true);
		videoRef.current?.pause();
		// Shrink into the chip of the item on screen; fall back to the one that opened the viewer.
		const chip = getOrigin(activeKeyRef.current) ?? getOrigin(openKeyRef.current);
		const done = () => {
			(chip ?? openerRef.current)?.focus?.({ preventScroll: true });
			onClosed();
		};
		if (reduce) {
			done();
			return;
		}
		const transition = boxTransition(CLOSE_MS, CLOSE_EASE);
		if (chip && grownRef.current) {
			const r = chip.getBoundingClientRect();
			const vp = viewport();
			setBox((prev) => ({
				...prev,
				top: r.top - vp.top,
				left: r.left - vp.left,
				width: r.width,
				height: r.height,
				opacity: 0,
				transform: "scale(0.95)",
				transition,
			}));
		} else {
			setBox((prev) => ({ ...prev, opacity: 0, transform: "scale(0.96)", transition }));
		}
		closeTimerRef.current = window.setTimeout(done, CLOSE_MS);
	}, [getOrigin, onClosed, reduce, viewport]);

	useOverlayBackClose(!closing, close);

	// --- Gallery ------------------------------------------------------------

	const go = React.useCallback(
		(dir: 1 | -1) => {
			if (count <= 1 || closingRef.current) return;
			const next = (index + dir + count) % count;
			videoRef.current?.pause();
			setZoom(1);
			setPan({ x: 0, y: 0 });
			setPlaying(false);
			onIndexChange(next);
			// Its own shape when known; otherwise the loading box, which it keeps once measured.
			const item = items[next];
			if (item) refit(item.key);
		},
		[count, index, items, onIndexChange, refit],
	);

	// --- Zoom and pan -------------------------------------------------------

	const failed = Boolean(active.failed) || broken.has(active.key);
	const canZoom = active.kind === "image" && Boolean(active.url) && !failed;

	const stageRect = React.useCallback((): Rect => {
		const r = stageRef.current?.getBoundingClientRect();
		return r ? { top: r.top, left: r.left, width: r.width, height: r.height } : { top: 0, left: 0, width: 0, height: 0 };
	}, []);

	const clampPan = React.useCallback(
		(next: { x: number; y: number }, z: number) => {
			const stage = stageRect();
			if (!stage.width || !stage.height) return { x: 0, y: 0 };
			// The image's on-screen size before zoom: fit to the stage, never past its own pixels.
			const size = sizesRef.current.get(activeKeyRef.current);
			const ratio = size ? size.w / size.h : stage.width / stage.height;
			const fit =
				ratio >= stage.width / stage.height
					? { w: stage.width, h: stage.width / ratio }
					: { w: stage.height * ratio, h: stage.height };
			const shown = size && size.w < fit.w ? { w: size.w, h: size.h } : fit;
			const maxX = Math.max(0, (shown.w * z - stage.width) / 2);
			const maxY = Math.max(0, (shown.h * z - stage.height) / 2);
			return { x: Math.min(maxX, Math.max(-maxX, next.x)), y: Math.min(maxY, Math.max(-maxY, next.y)) };
		},
		[stageRect],
	);

	/** Zoom so the point under (x, y), in stage coordinates, stays put. */
	const zoomAt = React.useCallback(
		(next: number, x: number, y: number) => {
			if (next <= MIN_ZOOM) {
				setZoom(MIN_ZOOM);
				setPan({ x: 0, y: 0 });
				return;
			}
			const stage = stageRect();
			const ratio = next / zoom;
			const target = {
				x: pan.x + (stage.width / 2 - x) * (ratio - 1),
				y: pan.y + (stage.height / 2 - y) * (ratio - 1),
			};
			setZoom(next);
			setPan(clampPan(target, next));
		},
		[clampPan, pan.x, pan.y, stageRect, zoom],
	);

	const zoomBy = (delta: number) => {
		if (!canZoom) return;
		const stage = stageRect();
		zoomAt(clampZoom(zoom + delta), stage.width / 2, stage.height / 2);
	};

	const resetZoom = () => {
		setZoom(MIN_ZOOM);
		setPan({ x: 0, y: 0 });
	};

	// Ctrl/⌘ + wheel (and trackpad pinch, which browsers send as ctrl+wheel). Non-passive to stop page zoom.
	React.useEffect(() => {
		const stage = stageRef.current;
		if (!stage) return;
		const onWheel = (event: WheelEvent) => {
			if (!canZoom || !(event.ctrlKey || event.metaKey)) return;
			event.preventDefault();
			const r = stageRect();
			zoomAt(clampZoom(zoom + (event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP)), event.clientX - r.left, event.clientY - r.top);
		};
		stage.addEventListener("wheel", onWheel, { passive: false });
		return () => stage.removeEventListener("wheel", onWheel);
	}, [canZoom, stageRect, zoom, zoomAt]);

	const onDoubleClick = (event: React.MouseEvent) => {
		if (!canZoom) return;
		event.preventDefault();
		if (zoom > MIN_ZOOM) {
			resetZoom();
			return;
		}
		const r = stageRect();
		zoomAt(clampZoom(zoom + 1), event.clientX - r.left, event.clientY - r.top);
	};

	const onMouseDown = (event: React.MouseEvent) => {
		if (zoom <= MIN_ZOOM || event.button !== 0) return;
		event.preventDefault();
		dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y, moved: false };
		setDragging(true);
	};

	React.useEffect(() => {
		if (!dragging) return;
		const onMove = (event: MouseEvent) => {
			const drag = dragRef.current;
			if (!drag) return;
			const dx = event.clientX - drag.x;
			const dy = event.clientY - drag.y;
			if (!drag.moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) drag.moved = true;
			const next = clampPan({ x: drag.panX + dx, y: drag.panY + dy }, zoom);
			if (panRafRef.current) cancelAnimationFrame(panRafRef.current);
			panRafRef.current = requestAnimationFrame(() => setPan(next));
		};
		const onUp = () => {
			dragRef.current = null;
			setDragging(false);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
		return () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
	}, [clampPan, dragging, zoom]);

	const onTouchStart = (event: React.TouchEvent) => {
		if (event.touches.length === 2 && canZoom) {
			const [a, b] = [event.touches[0]!, event.touches[1]!];
			const r = stageRect();
			pinchRef.current = {
				distance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
				zoom,
				x: (a.clientX + b.clientX) / 2 - r.left,
				y: (a.clientY + b.clientY) / 2 - r.top,
			};
			dragRef.current = null;
			swipeRef.current = null;
			setDragging(false);
			return;
		}
		const touch = event.touches[0];
		if (!touch) return;
		if (zoom > MIN_ZOOM) {
			dragRef.current = { x: touch.clientX, y: touch.clientY, panX: pan.x, panY: pan.y, moved: false };
			return;
		}
		swipeRef.current = { x: touch.clientX, y: touch.clientY };
	};

	const onTouchMove = (event: React.TouchEvent) => {
		const pinch = pinchRef.current;
		if (pinch && event.touches.length === 2) {
			const [a, b] = [event.touches[0]!, event.touches[1]!];
			const distance = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
			zoomAt(clampZoom(pinch.zoom * (distance / pinch.distance)), pinch.x, pinch.y);
			return;
		}
		const drag = dragRef.current;
		const touch = event.touches[0];
		if (!drag || !touch || zoom <= MIN_ZOOM) return;
		setPan(clampPan({ x: drag.panX + touch.clientX - drag.x, y: drag.panY + touch.clientY - drag.y }, zoom));
	};

	const onTouchEnd = (event: React.TouchEvent) => {
		if (pinchRef.current && event.touches.length < 2) pinchRef.current = null;
		dragRef.current = null;
		const start = swipeRef.current;
		swipeRef.current = null;
		const touch = event.changedTouches[0];
		if (!start || !touch || zoom !== MIN_ZOOM) return;
		const dy = touch.clientY - start.y;
		const dx = touch.clientX - start.x;
		if (Math.abs(dy) > SWIPE_CLOSE_PX && Math.abs(dy) > Math.abs(dx)) close();
	};

	// --- Keys ---------------------------------------------------------------

	const onKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			close();
			return;
		}
		if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
			if (count <= 1 || (event.target as HTMLElement).closest?.(OWNS_ARROWS)) return;
			event.preventDefault();
			event.stopPropagation();
			go(event.key === "ArrowRight" ? 1 : -1);
			return;
		}
		if (event.key !== "Tab") return;
		const focusables = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
		if (focusables.length === 0) {
			event.preventDefault();
			return;
		}
		const first = focusables[0]!;
		const last = focusables[focusables.length - 1]!;
		if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};

	if (!mounted) return null;

	const fadeMs = reduce ? 0 : closing ? CLOSE_MS : OPEN_MS;
	const isVideo = active.kind === "video";

	let body: React.ReactNode;
	if (failed) {
		const href = active.url ?? active.fallbackHref;
		body = (
			<div className="flex flex-col items-center gap-3 px-6 text-center text-white">
				<p className="text-[13px] text-white/80">
					Couldn&apos;t {isVideo ? "play" : "load"} {active.filename}.
				</p>
				{href && (
					<a
						href={href}
						download={active.filename}
						className="inline-flex items-center gap-2 rounded-pill bg-white/15 px-4 py-2 text-[12.5px] font-medium transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
					>
						<Download aria-hidden className="size-3.5" />
						Download
					</a>
				)}
			</div>
		);
	} else if (!active.url) {
		body = (
			<p role="status" className="flex items-center gap-2 text-[12.5px] text-white/80">
				<LoaderCircle aria-hidden className="size-4 animate-spin" />
				Loading {active.filename}…
			</p>
		);
	} else if (isVideo) {
		body = (
			<video
				ref={videoRef}
				src={active.url}
				controls
				autoPlay
				playsInline
				onPlay={() => setPlaying(true)}
				onPause={() => setPlaying(false)}
				onEnded={() => setPlaying(false)}
				onError={() => setBroken((prev) => new Set(prev).add(active.key))}
				className="size-full bg-black object-contain"
			/>
		);
	} else {
		body = (
			// eslint-disable-next-line @next/next/no-img-element -- a local blob URL, nothing for next/image to optimize
			<img
				src={active.url}
				alt={active.filename}
				draggable={false}
				onError={() => setBroken((prev) => new Set(prev).add(active.key))}
				// Shrinks to fit but never stretches past its own pixels: small images stay sharp.
				className="max-h-full max-w-full object-contain"
				style={{
					transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
					transition: dragging || reduce ? "none" : "transform 200ms ease-out",
					willChange: dragging ? "transform" : undefined,
				}}
			/>
		);
	}

	return createPortal(
		<div ref={overlayRef} className="fixed inset-0 z-50 select-none">
			<motion.div
				aria-hidden
				className="absolute inset-0 bg-black/60 backdrop-blur-sm"
				initial={{ opacity: 0 }}
				animate={{ opacity: closing ? 0 : 1 }}
				transition={{ duration: fadeMs / 1000, ease: "easeOut" }}
				onClick={close}
			/>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-label={`Preview of ${active.filename}`}
				tabIndex={-1}
				className="fixed overflow-hidden bg-black shadow-lift ring-1 ring-white/10 outline-none sm:rounded-2xl"
				style={box}
				onKeyDown={onKeyDown}
				onTouchStart={onTouchStart}
				onTouchMove={onTouchMove}
				onTouchEnd={onTouchEnd}
			>
				{canZoom && (
					<div
						aria-hidden
						className="pointer-events-none absolute inset-0 scale-110 opacity-60 blur-2xl"
						style={{ background: `url("${active.url}") center / cover` }}
					/>
				)}

				<div
					ref={stageRef}
					className={cn(
						"absolute inset-0 overflow-hidden",
						canZoom && (zoom > MIN_ZOOM ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"),
					)}
					style={{ touchAction: isVideo || zoom <= MIN_ZOOM ? "pan-y" : "none" }}
					onMouseDown={canZoom ? onMouseDown : undefined}
					onDoubleClick={onDoubleClick}
				>
					<AnimatePresence initial={false}>
						<motion.div
							key={active.key}
							className="absolute inset-0 grid place-items-center"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: reduce ? 0 : 0.22, ease: "easeOut" }}
						>
							{body}
						</motion.div>
					</AnimatePresence>
				</div>

				<div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start gap-3 bg-linear-to-b from-black/65 via-black/30 to-transparent px-3 pt-2.5 pb-10 text-white sm:px-4">
					<div className="min-w-0 flex-1 pt-0.5">
						<p className="truncate text-[13px] leading-snug font-medium">{active.filename}</p>
						<p className="font-mono text-[10.5px] text-white/65 tabular">{formatBytes(active.size)}</p>
					</div>
					<div className="pointer-events-auto flex shrink-0 items-center gap-0.5">
						{canZoom && (
							<>
								<AnimatePresence>
									{zoom > MIN_ZOOM && (
										<motion.div
											initial={{ opacity: 0, x: 8 }}
											animate={{ opacity: 1, x: 0 }}
											exit={{ opacity: 0, x: 8 }}
											transition={{ duration: reduce ? 0 : 0.18 }}
											className="mr-1 flex items-center gap-1"
										>
											<button
												type="button"
												onClick={resetZoom}
												className="rounded-pill px-2 py-1 text-[11.5px] font-medium text-white/85 transition-colors hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
											>
												Reset
											</button>
											<span className="rounded-pill bg-white/15 px-2 py-0.5 font-mono text-[11px] tabular">
												{Math.round(zoom * 100)}%
											</span>
										</motion.div>
									)}
								</AnimatePresence>
								<Tip label="Zoom out" type="button" aria-label="Zoom out" onClick={() => zoomBy(-ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} className={CHROME}>
									<Minus aria-hidden className="size-4" />
								</Tip>
								<Tip label="Zoom in" type="button" aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} className={CHROME}>
									<Plus aria-hidden className="size-4" />
								</Tip>
								<span aria-hidden className="mx-1 h-4 w-px bg-white/25" />
							</>
						)}
						{active.url && (
							<>
								{/* The blob carries the previewType, so a new tab shows the same safe view. */}
								<Tip
									label="Open in new tab"
									render={<a href={active.url} target="_blank" rel="noopener" aria-label="Open in new tab" className={CHROME} />}
								>
									<ExternalLink aria-hidden className="size-4" />
								</Tip>
								<Tip
									label={`Download ${active.filename}`}
									render={<a href={active.url} download={active.filename} aria-label={`Download ${active.filename}`} className={CHROME} />}
								>
									<Download aria-hidden className="size-4" />
								</Tip>
							</>
						)}
						<Tip label="Close" type="button" aria-label="Close preview" onClick={close} className={CHROME}>
							<X aria-hidden className="size-4" />
						</Tip>
					</div>
				</div>

				{count > 1 && (
					<>
						<button type="button" aria-label="Previous attachment" onClick={() => go(-1)} className={cn(NAV, "left-3")}>
							<ChevronLeft aria-hidden className="size-5" />
						</button>
						<button type="button" aria-label="Next attachment" onClick={() => go(1)} className={cn(NAV, "right-3")}>
							<ChevronRight aria-hidden className="size-5" />
						</button>
						<AnimatePresence>
							{!(isVideo && playing) && (
								<motion.p
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									exit={{ opacity: 0 }}
									transition={{ duration: reduce ? 0 : 0.18 }}
									className={cn(
										"pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded-pill bg-black/50 px-3 py-1 font-mono text-[11px] text-white tabular backdrop-blur-sm",
										// Paused video: clear the native control bar.
										isVideo && active.url && !failed ? "bottom-16" : "bottom-3",
									)}
								>
									{index + 1} / {count}
								</motion.p>
							)}
						</AnimatePresence>
					</>
				)}
			</div>
		</div>,
		document.body,
	);
}
