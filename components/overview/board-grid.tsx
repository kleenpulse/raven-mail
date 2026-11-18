"use client";

import * as React from "react";
import {
	Activity,
	ChartColumn,
	ChartPie,
	Check,
	CloudSun,
	Flame,
	GripVertical,
	Hourglass,
	LayoutGrid,
	Newspaper,
	Orbit,
	Pencil,
	Plus,
	Radar,
	Reply,
	RotateCcw,
	X,
	type LucideIcon,
} from "lucide-react";
import { GridLayout, useContainerWidth, type Layout, type LayoutItem } from "react-grid-layout";
import { absoluteStrategy, getBreakpointFromWidth, type PositionStrategy } from "react-grid-layout/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WIDGET_TOUR_TARGET, tourAttr } from "@/components/tour/anchors";
import { useTourStore } from "@/components/tour/store";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useUiZoom } from "@/hooks/use-ui-zoom";
import {
	BREAKPOINTS,
	COLS,
	GAP,
	ROW_HEIGHT,
	nudge,
	readingOrder,
	sameLayout,
	sizeLimits,
	type BoardItem,
	type BoardLayouts,
	type KeyAction,
} from "@/lib/overview-board/layout";
import { moveCards, resetBoard, restoreBoard, setBoardBusy, setCardsOn, useBoard, type BoardSave } from "@/lib/overview-board/state";
import { BREAKPOINT_NAMES, type Breakpoint } from "@/lib/overview-board/types";
import { WIDGETS, widgetDef, type WidgetId } from "@/lib/overview-board/widgets";
import { cn } from "@/lib/utils";

/*
 * The Overview board: the cards on a grid the user can arrange. Editing is a
 * mode, so a stray touch never drags a card and everything inside the cards
 * stays usable the rest of the time. In edit mode each card's grip moves it
 * with the arrow keys and resizes it with Shift+arrows, since dragging has no
 * keyboard path.
 *
 * The cards themselves know nothing about any of this (the landing page reuses
 * them): this file places them and draws the edit chrome on top.
 */

const ICONS: Record<WidgetId, LucideIcon> = {
	"needs-reply": Reply,
	volume: ChartColumn,
	"inbox-weather": CloudSun,
	streak: Flame,
	"mail-mix": ChartPie,
	"threads-radar": Radar,
	"daily-brief": Newspaper,
	"rhythm-spark": Activity,
	orbit: Orbit,
	"reply-debt": Hourglass,
};

/** What the status line says about the last edit. Nothing to say before the first one. */
const SAVE_LABEL: Record<BoardSave, string | null> = {
	idle: null,
	saving: "Saving…",
	saved: "Saved",
	device: "Saved on this device",
	waiting: "Saved on this device, not synced yet",
};

const KEYS: Record<string, KeyAction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

// Module constants: the grid's tiles re-render whenever these change identity.
const MARGIN: [number, number] = [GAP, GAP];
const PADDING: [number, number] = [0, 0];
const RESIZE_HANDLES: ["se"] = ["se"];

function pick(items: Layout): BoardItem[] {
	return items.map((l) => ({ i: l.i as WidgetId, x: l.x, y: l.y, w: l.w, h: l.h }));
}

function withLimits(layouts: BoardLayouts): Record<Breakpoint, LayoutItem[]> {
	const out = {} as Record<Breakpoint, LayoutItem[]>;
	for (const bp of BREAKPOINT_NAMES) {
		out[bp] = layouts[bp].map((item) => {
			const { minW, maxW, minH, maxH } = sizeLimits(item.i, bp);
			return { ...item, minW, maxW, minH, maxH };
		});
	}
	return out;
}

export function BoardGrid({ tiles }: { tiles: Record<WidgetId, React.ReactNode> }) {
	const { board, doc, ready, save } = useBoard();
	// Always the saved board, never what the grid reports back. These layouts are already packed
	// by the grid's own rules, so its re-pack on mount or at a breakpoint has nothing to add, and
	// the layout it reports while the width is crossing a breakpoint is the old width's cards
	// squeezed into the new width's columns.
	//
	// For the same reason this drives the plain grid and picks the breakpoint itself, instead of
	// using the library's responsive wrapper: that wrapper files the squeezed layout under the
	// new breakpoint's name and keeps it, so resizing a window across two breakpoints left the
	// board on the wrong layout. Here the layout and its column count always change together.
	const layouts = board.layouts;

	const tourActive = useTourStore().isActive;
	const [wantsEdit, setWantsEdit] = React.useState(false);
	// Reading order frozen while editing: moving the focused grip in the DOM would drop focus.
	const [frozen, setFrozen] = React.useState<WidgetId[] | null>(null);
	// Once the user has arranged anything, cards moved in the DOM must not replay their entrance.
	const [arranged, setArranged] = React.useState(false);
	if (tourActive && wantsEdit) {
		setWantsEdit(false);
		setFrozen(null);
	}
	const editing = wantsEdit && !tourActive;

	const [announcement, setAnnouncement] = React.useState("");
	const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true, debounceTimeout: 50 });
	const bp = getBreakpointFromWidth<Breakpoint>(BREAKPOINTS, width);
	const zoom = useUiZoom();
	// Tiles are placed with top/left, not a transform, so nothing inside a card ever measures
	// itself under a moving transformed ancestor. `scale` keeps a dragged card under the pointer
	// when Interface Size zooms the app frame.
	const strategy = React.useMemo<PositionStrategy>(() => ({ ...absoluteStrategy, scale: zoom }), [zoom]);
	const touch = useMediaQuery("(any-pointer: coarse)");

	const toolbar = React.useRef<HTMLDivElement>(null);
	const gridLayouts = React.useMemo(() => withLimits(layouts), [layouts]);
	const dragConfig = React.useMemo(
		() => ({ enabled: editing, cancel: "[data-no-drag]", threshold: 4, handle: touch ? "[data-board-grip]" : undefined }),
		[editing, touch],
	);
	const resizeConfig = React.useMemo(() => ({ enabled: editing, handles: RESIZE_HANDLES }), [editing]);
	const gridConfig = React.useMemo(() => ({ cols: COLS[bp], rowHeight: ROW_HEIGHT, margin: MARGIN, containerPadding: PADDING }), [bp]);

	const hint = touch ? "Drag a card by its handle, corner to resize" : "Drag to move, corner to resize";
	// A save still on its way, or one that could not be sent, is worth saying outside edit mode too
	// (Undo on the reset toast edits the board from there). "Saved" is only an answer while editing.
	const pending = save === "saving" || save === "waiting";
	const status = editing || pending ? (SAVE_LABEL[save] ?? (editing ? hint : "Your board")) : "Your board";

	const on = board.on;
	const empty = on.length === 0;
	const available = WIDGETS.filter((w) => !on.includes(w.id));
	const pristine = BREAKPOINT_NAMES.every((name) => !doc[name]?.items) && (!doc.widgets || doc.widgets.on === null);

	const readingKey = readingOrder(layouts[bp]).join("|");
	const order = React.useMemo(() => {
		const base = frozen ?? (readingKey ? (readingKey.split("|") as WidgetId[]) : []);
		const kept = base.filter((id) => on.includes(id));
		return [...kept, ...on.filter((id) => !kept.includes(id))];
	}, [frozen, readingKey, on]);

	const setEditing = (next: boolean) => {
		setWantsEdit(next);
		setFrozen(next ? order : null);
		if (next) setArranged(true);
	};

	const add = (id: WidgetId) => {
		setCardsOn([...on, id]);
		setAnnouncement(`${widgetDef(id).title} added to the board.`);
	};

	const remove = (id: WidgetId) => {
		setCardsOn(on.filter((other) => other !== id));
		setAnnouncement(`${widgetDef(id).title} removed.`);
		// The focused remove button is gone: land on the toolbar, not <body>.
		requestAnimationFrame(() => {
			toolbar.current?.querySelector<HTMLButtonElement>("button")?.focus();
		});
	};

	const reset = () => {
		const before = resetBoard();
		setAnnouncement("Board reset to the default.");
		toast("Your board is back to the default", {
			action: { label: "Undo", onClick: () => restoreBoard(before) },
		});
	};

	const onGripKey = (id: WidgetId, e: React.KeyboardEvent) => {
		const action = KEYS[e.key];
		if (!action) return;
		e.preventDefault();
		const mode = e.shiftKey ? "resize" : "move";
		const moved = nudge(layouts[bp], id, action, mode, bp);
		const { title } = widgetDef(id);
		if (!moved) {
			setAnnouncement(mode === "move" ? `${title} can't move ${action}.` : `${title} is at its size limit.`);
			return;
		}
		moveCards(bp, moved);
		const item = moved.find((l) => l.i === id);
		if (item) {
			setAnnouncement(
				`${title}: column ${String(item.x + 1)}, row ${String(item.y + 1)}, ${String(item.w)} wide, ${String(item.h)} tall.`,
			);
		}
	};

	const onGestureStart = () => {
		setBoardBusy(true);
	};

	// The grid keeps a dragged or resized tile's pixel position in a ref and only reads it when
	// that tile re-renders, which it does only when its child element below is a new one. Left
	// alone, a tile hops from cell to cell instead of following the pointer. Re-rendering here on
	// every step hands the grid new wrapper elements, and the tile follows.
	const [, follow] = React.useReducer((n: number) => n + 1, 0);
	const onGestureMove = React.useCallback(() => {
		follow();
	}, []);

	// The user let go of a card: this is the one place a drag or resize is saved.
	const onGestureStop = (layout: Layout) => {
		const next = pick(layout);
		if (!sameLayout(layouts[bp], next)) moveCards(bp, next);
		setBoardBusy(false);
	};

	// Do not memoise these wrappers: new elements on every render are what lets a dragged tile
	// follow the pointer (see onGestureMove). The cards do not pay for it. `tiles[id]` is a stable
	// element and TileBody is memoised, so React skips each card's subtree; only these thin
	// wrappers and the chrome re-render.
	const children = order.map((id) => (
		<div key={id} data-widget={id} className="group/tile">
			<TileBody id={id} inert={editing}>
				{tiles[id]}
			</TileBody>
			{editing && (
				<EditChrome
					title={widgetDef(id).title}
					onKey={(e) => {
						onGripKey(id, e);
					}}
					onRemove={() => {
						remove(id);
					}}
				/>
			)}
		</div>
	));

	return (
		<div className="flex flex-col gap-4">
			<div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
				<p className="readout" aria-live="polite">
					{status}
				</p>
				<div ref={toolbar} className="flex items-center gap-2">
					{editing && !empty && (
						<>
							<WidgetPicker available={available} onAdd={add} />
							<Button type="button" variant="surface" size="pill-sm" disabled={pristine} onClick={reset}>
								<RotateCcw aria-hidden />
								Reset
							</Button>
						</>
					)}
					{ready && !empty && (
						<Button
							type="button"
							aria-pressed={editing}
							variant={editing ? "inverse" : "surface"}
							size="pill-sm"
							onClick={() => {
								setEditing(!editing);
							}}
						>
							{editing ? <Check aria-hidden /> : <Pencil aria-hidden />}
							{editing ? "Done" : "Edit board"}
						</Button>
					)}
				</div>
			</div>

			<p className="sr-only" aria-live="assertive">
				{announcement}
			</p>

			{ready && empty && (
				<div className="bento flex flex-col items-center gap-3 px-5 py-12 text-center">
					<p className="font-display text-[17px] leading-tight">Your board is empty</p>
					<p className="max-w-[340px] text-[13px] text-ink-2">Add a card to start again, or put the default board back.</p>
					<div className="mt-1 flex items-center gap-2">
						<WidgetPicker available={available} onAdd={add} label="Add a card" />
						<Button type="button" variant="surface" size="pill-sm" onClick={reset}>
							<RotateCcw aria-hidden />
							Reset
						</Button>
					</div>
				</div>
			)}

			{/* Always in the tree, even for an empty board: the width is only measured on a container that exists at mount. */}
			{/* data-ready: the saved board is drawn. The tour reads it to tell a card that was removed from one still loading. */}
			<div
				ref={containerRef}
				data-board=""
				data-ready={ready && mounted ? "" : undefined}
				data-editing={editing ? "" : undefined}
				data-intro={arranged ? "off" : undefined}
			>
				{ready && mounted ? (
					!empty && (
						<GridLayout
							width={width}
							layout={gridLayouts[bp]}
							gridConfig={gridConfig}
							positionStrategy={strategy}
							dragConfig={dragConfig}
							resizeConfig={resizeConfig}
							onDragStart={onGestureStart}
							onDrag={onGestureMove}
							onDragStop={onGestureStop}
							onResizeStart={onGestureStart}
							onResize={onGestureMove}
							onResizeStop={onGestureStop}
						>
							{children}
						</GridLayout>
					)
				) : (
					<div aria-hidden className="min-h-[352px]" />
				)}
			</div>
		</div>
	);
}

/**
 * One card's slot. The card fills it; a card taller than its tile scrolls
 * inside itself, with a fade at the foot while there is more below.
 */
const TileBody = React.memo(function TileBody({ id, inert, children }: { id: WidgetId; inert: boolean; children: React.ReactNode }) {
	const ref = React.useRef<HTMLDivElement>(null);
	const anchor = WIDGET_TOUR_TARGET[id];

	React.useEffect(() => {
		const body = ref.current;
		const card = body?.firstElementChild;
		if (!body || !(card instanceof HTMLElement)) return;
		let frame = 0;
		const check = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				body.toggleAttribute("data-cut", card.scrollHeight - card.scrollTop - card.clientHeight > 4);
			});
		};
		// The card's scroll height has no observer of its own: watch the card and what it holds.
		const sizes = new ResizeObserver(check);
		const watch = () => {
			sizes.disconnect();
			sizes.observe(card);
			for (const child of card.children) sizes.observe(child);
		};
		const kids = new MutationObserver(() => {
			watch();
			check();
		});
		kids.observe(card, { childList: true });
		watch();
		card.addEventListener("scroll", check, { passive: true });
		check();
		return () => {
			cancelAnimationFrame(frame);
			sizes.disconnect();
			kids.disconnect();
			card.removeEventListener("scroll", check);
		};
	}, []);

	return (
		<div
			ref={ref}
			inert={inert}
			data-tile-body=""
			{...(anchor ? tourAttr(anchor) : undefined)}
			className="relative h-full *:h-full *:overflow-x-hidden *:overflow-y-auto"
		>
			{children}
		</div>
	);
});

function EditChrome({
	title,
	onKey,
	onRemove,
}: {
	title: string;
	onKey: (e: React.KeyboardEvent) => void;
	onRemove: () => void;
}) {
	return (
		<>
			<span aria-hidden className="pointer-events-none absolute inset-0 rounded-card ring-2 ring-signal/40 ring-inset" />
			<div className="absolute top-3 right-3 flex items-center gap-1">
				{/* A button so it takes focus: the keyboard path. A pointer can drag from it too. */}
				<Button
					type="button"
					variant="glass"
					size="circle-sm"
					data-board-grip=""
					aria-label={`Move ${title}. Arrow keys move it, Shift with arrow keys resizes it.`}
					aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
					onKeyDown={onKey}
					className="size-8 cursor-grab shadow-card"
				>
					<GripVertical aria-hidden />
				</Button>
				<Button
					type="button"
					variant="glass"
					size="circle-sm"
					data-no-drag=""
					aria-label={`Remove ${title}`}
					onClick={onRemove}
					className="size-8 shadow-card"
				>
					<X aria-hidden />
				</Button>
			</div>
		</>
	);
}

function WidgetPicker({
	available,
	onAdd,
	label = "Add card",
}: {
	available: readonly (typeof WIDGETS)[number][];
	onAdd: (id: WidgetId) => void;
	label?: string;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button type="button" variant="surface" size="pill-sm" />}>
				<Plus aria-hidden />
				{label}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-72">
				{available.length === 0 ? (
					<div className="flex items-center gap-2.5 px-2.5 py-2 text-[13px] text-ink-2">
						<LayoutGrid aria-hidden className="size-4 shrink-0" />
						Every card is on the board.
					</div>
				) : (
					available.map((w) => {
						const Icon = ICONS[w.id];
						return (
							<DropdownMenuItem
								key={w.id}
								className="h-auto items-start gap-2.5 py-2"
								onClick={() => {
									onAdd(w.id);
								}}
							>
								<Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0")} />
								<span className="flex min-w-0 flex-col">
									<span className="text-foreground">{w.title}</span>
									<span className="text-[12px] text-ink-2">{w.blurb}</span>
								</span>
							</DropdownMenuItem>
						);
					})
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
