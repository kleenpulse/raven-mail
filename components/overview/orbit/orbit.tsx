"use client";

import * as React from "react";
import { List as ListIcon, Orbit as OrbitIcon } from "lucide-react";
import type { SenderStat } from "@/lib/insights/types";
import type { TriageCategory } from "@/lib/mail/types";
import { Kbd } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";
import { BackButton, Drilldown } from "./drilldown";
import { displayName, formatCount, plural } from "./format";
import { useContainerWidth, useInView, useNow, usePageVisible } from "./hooks";
import {
	categoryShares,
	layoutFocus,
	layoutOrbit,
	normalizeSenders,
	type OrbitSender,
	type WeekIndex,
} from "./layout";
import { OrbitList } from "./list";
import { OrbitScene, makeOrbitIds, type SceneFocus } from "./scene";
import { capitalize, MAIL_VOCAB, type OrbitVocab } from "./vocab";

type View = "constellation" | "list";
type WeekKey = "all" | "w1" | "w2" | "w3" | "w4";
type WeekOption = { key: WeekKey; label: string; spoken: string; week: WeekIndex | null };

const WEEK_KEYS = ["w1", "w2", "w3", "w4"] as const;

function weekOptions(vocab: OrbitVocab): WeekOption[] {
	if (!vocab.period) return [{ key: "all", label: "", spoken: "", week: null }];
	return [
		{ key: "all", ...vocab.period.all, week: null },
		...vocab.period.weeks.slice(0, 4).map(([label, spoken], i) => ({ key: WEEK_KEYS[i]!, label, spoken, week: i as WeekIndex })),
	];
}

/** Below this container width the ranked list is the default view. */
const LIST_BELOW = 640;
/** Ignition finishes by then; afterwards remounts skip it (data-intro="off"). */
const IGNITION_MS = 2000;

function stageHeight(width: number): number {
	if (width >= 1024) return 470;
	if (width >= 768) return 450;
	if (width >= LIST_BELOW) return 420;
	return Math.round(Math.min(420, Math.max(320, width)));
}

export type OrbitProps = {
	/** Up to 24, sorted by count desc. */
	senders: SenderStat[];
	categories: { category: TriageCategory; count: number }[];
	className?: string;
	/** Words for a non-mail domain; defaults to mail. */
	vocab?: OrbitVocab;
};

/**
 * Relationship constellation: you at the centre, categories on ring 1, the
 * people and services who write most on ring 2. Select a sender to focus it.
 */
export function Orbit({ senders: sendersIn, categories, className, vocab = MAIL_VOCAB }: OrbitProps): React.JSX.Element {
	const rootRef = React.useRef<HTMLDivElement>(null);
	const width = useContainerWidth(rootRef);
	const reduced = useReducedMotion();
	const now = useNow();
	const { inView, seen, known } = useInView(rootRef);
	// Only hold the ignition when we positively know the widget mounted off screen.
	const held = known && !seen;
	const pageVisible = usePageVisible();

	const senders = React.useMemo(() => normalizeSenders(sendersIn), [sendersIn]);
	const byId = React.useMemo(() => new Map(senders.map((s) => [s.address, s])), [senders]);
	const labels = vocab.categoryLabel;
	const allShares = React.useMemo(() => categoryShares(senders, categories, null, labels), [senders, categories, labels]);
	const options = React.useMemo(() => weekOptions(vocab), [vocab]);
	const total = allShares.reduce((a, c) => a + c.count, 0);

	const [weekKey, setWeekKey] = React.useState<WeekKey>("all");
	const week = (options.find((o) => o.key === weekKey) ?? options[0]!).week;
	const [userView, setUserView] = React.useState<View | null>(null);
	const view: View = userView ?? (width > 0 && width < LIST_BELOW ? "list" : "constellation");

	const [focusId, setFocusId] = React.useState<string | null>(null);
	const [activeId, setActiveId] = React.useState<string | null>(null);
	const [hoverId, setHoverId] = React.useState<string | null>(null);
	const [keyFocusId, setKeyFocusId] = React.useState<string | null>(null);
	const [announcement, setAnnouncement] = React.useState("");
	const [settled, setSettled] = React.useState(false);
	// Orbs glide only while focusing/unfocusing, so resizes don't drag them behind their links.
	const [glide, setGlide] = React.useState(0);
	const [glideDone, setGlideDone] = React.useState(0);
	const restoreRef = React.useRef<string | null>(null);

	const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
	const ids = React.useMemo(() => makeOrbitIds(uid), [uid]);

	const stageH = stageHeight(width);
	const layout = React.useMemo(
		() => (width > 0 && senders.length ? layoutOrbit(senders, categories, width, stageH, week, labels) : null),
		[senders, categories, width, stageH, week, labels],
	);

	const focusSender = focusId ? byId.get(focusId) : undefined;
	// "View all" swaps the drilldown for the domain's full view of the focused node.
	const [expanded, setExpanded] = React.useState(false);
	const expandedView = expanded && focusSender && vocab.expand ? vocab.expand : null;
	const focusIds = React.useMemo(
		() => (focusSender ? vocab.focus.cards(focusSender, now).map((c) => c.id) : []),
		[focusSender, vocab, now],
	);
	const focusGeom = React.useMemo(
		() => (focusSender && width > 0 ? layoutFocus(width, stageH, focusIds) : null),
		[focusSender, width, stageH, focusIds],
	);
	// The expanded view flows at its own height, like the compact drilldown.
	const compactFocus = expandedView ? true : (focusGeom?.compact ?? false);
	const sceneFocus: SceneFocus =
		focusSender && focusGeom && !compactFocus && view === "constellation"
			? { id: focusSender.address, x: focusGeom.orb.x, y: focusGeom.orb.y, r: focusGeom.orb.r }
			: null;

	const constellationReady = layout !== null && view === "constellation" && !held;
	React.useEffect(() => {
		if (!constellationReady || settled) return;
		const t = window.setTimeout(() => setSettled(true), IGNITION_MS);
		return () => window.clearTimeout(t);
	}, [constellationReady, settled]);

	React.useEffect(() => {
		if (glide === glideDone) return;
		const t = window.setTimeout(() => setGlideDone(glide), 760);
		return () => window.clearTimeout(t);
	}, [glide, glideDone]);

	const ambient = settled && !reduced && inView && pageVisible && view === "constellation" && !focusSender;
	const tabStop = activeId && byId.has(activeId) ? activeId : (senders[0]?.address ?? null);

	// Return focus to the orb (or row) the drilldown was opened from.
	React.useEffect(() => {
		if (focusId !== null || !restoreRef.current) return;
		const id = CSS.escape(restoreRef.current);
		restoreRef.current = null;
		rootRef.current
			?.querySelector<HTMLElement | SVGElement>(`[data-orbit-sender="${id}"], [data-orbit-row="${id}"]`)
			?.focus({ preventScroll: true });
	}, [focusId]);

	const open = React.useCallback(
		(id: string) => {
			const s = byId.get(id);
			if (!s) return;
			setSettled(true);
			setHoverId(null);
			setKeyFocusId(null);
			setActiveId(id);
			setFocusId(id);
			setExpanded(false);
			setGlide((g) => g + 1);
			setAnnouncement(`${displayName(s)}: ${vocab.describe(s, now)}. Press Escape to go back.`);
		},
		[byId, now, vocab, setHoverId, setKeyFocusId, setAnnouncement, setExpanded],
	);

	const back = React.useCallback(() => {
		restoreRef.current = focusId;
		setFocusId(null);
		setExpanded(false);
		setGlide((g) => g + 1);
		setAnnouncement(`Back to the ${view === "list" ? "list" : "constellation"}.`);
	}, [focusId, view, setAnnouncement, setExpanded]);

	const ringOrder = React.useMemo(
		() => (layout ? [...layout.senders].sort((a, b) => a.ring - b.ring).map((s) => s.id) : []),
		[layout],
	);

	const navigate = React.useCallback(
		(id: string, key: string) => {
			const n = ringOrder.length;
			if (!n) return;
			const i = Math.max(0, ringOrder.indexOf(id));
			let next = id;
			if (key === "ArrowRight" || key === "ArrowDown") next = ringOrder[(i + 1) % n]!;
			else if (key === "ArrowLeft" || key === "ArrowUp") next = ringOrder[(i - 1 + n) % n]!;
			else if (key === "Home") next = senders[0]!.address;
			else if (key === "End") next = senders[senders.length - 1]!.address;
			setActiveId(next);
			rootRef.current
				?.querySelector<SVGElement>(`[data-orbit-sender="${CSS.escape(next)}"]`)
				?.focus({ preventScroll: true });
		},
		[ringOrder, senders],
	);

	const ariaLabelFor = React.useCallback(
		(node: OrbitSender) => {
			const s = byId.get(node.id);
			if (!s) return node.id;
			const amount = plural(node.value, vocab.unit[0], vocab.unit[1]);
			const parts = [
				displayName(s),
				week === null ? amount : `${amount} in ${vocab.window.week(week)}`,
				`${formatCount(s.unread)} ${vocab.flag.label}`,
			];
			if (now !== null) parts.push(vocab.recencyLong(s, now));
			parts.push(labels[s.category]);
			return parts.join(", ");
		},
		[byId, week, now, vocab, labels],
	);

	const onWeek = (next: string[]) => {
		const option = options.find((o) => o.key === next[0]);
		if (!option) return;
		setWeekKey(option.key);
		const lead = [...categoryShares(senders, categories, option.week, labels)].sort((a, b) => b.value - a.value)[0];
		setAnnouncement(`${option.spoken}.${lead && lead.value > 0 ? ` ${lead.label} leads with ${lead.text}.` : ""}`);
	};

	const onView = (next: string[]) => {
		const v = next[0] as View | undefined;
		if (!v || v === view) return;
		setSettled(true);
		setUserView(v);
		setFocusId(null);
		setExpanded(false);
		setHoverId(null);
		setAnnouncement(v === "list" ? "List view." : "Constellation view.");
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape" && focusSender) {
			e.preventDefault();
			e.stopPropagation();
			if (expandedView) setExpanded(false);
			else back();
		}
	};

	const fixedStage = width > 0 && ((view === "constellation" && !compactFocus) || (focusSender && !compactFocus));

	return (
		<div
			ref={rootRef}
			data-intro={reduced || settled ? "off" : undefined}
			data-orbit-hold={held && !reduced && !settled ? "" : undefined}
			onKeyDown={onKeyDown}
			className={cn(
				"relative min-w-0",
				// Ignition waits until the widget is first on screen.
				"[&[data-orbit-hold]_*]:[animation-play-state:paused]",
				// Skin roles: Ember is flat coral/peach/stone; Nebula is rose/lavender categories, mint/gold senders.
				"[--orbit-cat-0:var(--orb-1)] [--orbit-cat-1:var(--orb-1)] [--orbit-machine:var(--orb-4)] [--orbit-person:var(--orb-3)]",
				"dark:[--orbit-cat-0:var(--orb-3)] dark:[--orbit-cat-1:var(--orb-2)] dark:[--orbit-machine:var(--orb-1)] dark:[--orbit-person:var(--orb-4)]",
				// Text halo: labels knock out the dotted links behind them.
				"[--orbit-halo:var(--card)] dark:[--orbit-halo:rgb(14_31_32/0.92)]",
				"[&_.orbit-halo]:[paint-order:stroke] [&_.orbit-halo]:[stroke-linejoin:round] [&_.orbit-halo]:[stroke-width:3.5px] [&_.orbit-halo]:[stroke:var(--orbit-halo)]",
				className,
			)}
			style={{ ["--orbit-sun-paint" as string]: `url(#${ids.sun})` }}
		>
			{senders.length > 0 && (
				<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
					<p className="readout tabular">
						{formatCount(total)} {vocab.unit[1]} · {plural(senders.length, vocab.node[0], vocab.node[1])} ·{" "}
						{plural(allShares.length, vocab.group[0], vocab.group[1])}
					</p>
					<div className="flex flex-wrap items-center gap-2">
						{vocab.period && (
						<ToggleGroup
							aria-label="Time range"
							value={[weekKey]}
							onValueChange={onWeek}
							variant="pill"
							size="pill"
							spacing={0}
							inert={focusSender ? true : undefined}
							className={cn(
								"rounded-pill bg-sheet p-1 ring-1 ring-border transition-opacity dark:bg-background/40 dark:ring-glass-border",
								focusSender && "opacity-0",
							)}
						>
							{options.map((o) => (
								<ToggleGroupItem key={o.key} value={o.key} aria-label={o.spoken} className="h-8 min-w-0 rounded-pill px-3 tabular">
									{o.label}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
						)}
						<ToggleGroup
							aria-label="View"
							value={[view]}
							onValueChange={onView}
							variant="pill"
							size="pill"
							spacing={0}
							className="rounded-pill bg-sheet p-1 ring-1 ring-border dark:bg-background/40 dark:ring-glass-border"
						>
							<ToggleGroupItem value="constellation" aria-label="Constellation" className="h-8 min-w-0 gap-1.5 rounded-pill px-3">
								<OrbitIcon className="size-3.5" />
								<span className="hidden sm:inline">Constellation</span>
							</ToggleGroupItem>
							<ToggleGroupItem value="list" aria-label="List" className="h-8 min-w-0 gap-1.5 rounded-pill px-3">
								<ListIcon className="size-3.5" />
								<span className="hidden sm:inline">List</span>
							</ToggleGroupItem>
						</ToggleGroup>
					</div>
				</div>
			)}

			{senders.length === 0 ? (
				<EmptyOrbit vocab={vocab} />
			) : width === 0 ? (
				<div className="mt-4 h-[360px] sm:h-[470px]" aria-hidden />
			) : (
				<div className="relative mt-4" style={fixedStage ? { height: stageH } : undefined}>
					{view === "constellation" && layout && !(focusSender && compactFocus) && (
						<div inert={focusSender ? true : undefined} className="absolute inset-0">
							<OrbitScene
								layout={layout}
								senders={byId}
								ids={ids}
								focus={sceneFocus}
								activeId={tabStop}
								hoverId={hoverId}
								tipId={hoverId ?? keyFocusId}
								ambient={ambient}
								gliding={glide !== glideDone}
								now={now}
								vocab={vocab}
								ariaLabelFor={ariaLabelFor}
								onHover={setHoverId}
								onFocusNode={setKeyFocusId}
								onActivate={open}
								onNavigate={navigate}
							/>
						</div>
					)}
					{view === "list" && layout && !focusSender && (
						<OrbitList senders={senders} categories={layout.categories} week={week} now={now} vocab={vocab} onOpen={open} />
					)}
					{focusSender && expandedView && (
						<section key={focusSender.address} aria-label={`${displayName(focusSender)} details`} className="flex flex-col gap-4">
							<BackButton returnTo={displayName(focusSender)} onBack={() => setExpanded(false)} />
							{expandedView.render(focusSender)}
						</section>
					)}
					{focusSender && focusGeom && !expandedView && (
						<Drilldown
							key={focusSender.address}
							sender={focusSender}
							focus={vocab.focus}
							more={vocab.expand ? { label: vocab.expand.label(focusSender), onClick: () => setExpanded(true) } : undefined}
							geom={focusGeom}
							showOrb={view === "list" || compactFocus}
							now={now}
							reduced={reduced}
							returnTo={view === "list" ? "list" : "constellation"}
							onBack={back}
							onAnnounce={setAnnouncement}
						/>
					)}
				</div>
			)}

			{senders.length > 0 && view === "constellation" && !focusSender && width > 0 && (
				<div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-[12px] text-ink-2">
					<ul aria-label="Legend" className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
						<li className="inline-flex items-center gap-1.5">
							<span className="size-2.5 rounded-full bg-(--orbit-person) ring-1 ring-orb-1/70 dark:ring-0" />
							{vocab.legend.person}
						</li>
						<li className="inline-flex items-center gap-1.5">
							<span className="size-2.5 rounded-full bg-(--orbit-machine) ring-1 ring-ink-2/60 dark:ring-0" />
							{vocab.legend.machine}
						</li>
						<li className="inline-flex items-center gap-1.5">
							<span className="size-1.5 rounded-full bg-signal dark:bg-signal-2" />
							{capitalize(vocab.flag.label)}
						</li>
						<li className="inline-flex items-center gap-1.5">
							<span aria-hidden className="h-2.5 w-px bg-signal" />
							{vocab.legend.ring}
						</li>
					</ul>
					<p className="hidden items-center gap-1.5 lg:inline-flex">
						{vocab.legend.hint} · <Kbd>←</Kbd>
						<Kbd>→</Kbd> to move · <Kbd>Esc</Kbd> to return
					</p>
				</div>
			)}

			<p id={ids.hint} className="sr-only">
				{vocab.srHint}
			</p>
			<p aria-live="polite" className="sr-only">
				{announcement}
			</p>
		</div>
	);
}

function EmptyOrbit({ vocab }: { vocab: OrbitVocab }) {
	return (
		<div className="flex flex-col items-center gap-5 py-10 text-center">
			<svg width="168" height="168" viewBox="0 0 168 168" aria-hidden>
				<circle cx="84" cy="84" r="80" fill="none" strokeWidth={1} strokeDasharray="1 7" strokeLinecap="round" className="stroke-ink-3 dark:stroke-glass-border" />
				<circle cx="84" cy="84" r="52" fill="none" strokeWidth={1} className="stroke-border dark:stroke-glass-border" />
				<circle cx="84" cy="84" r="27" className="fill-signal-soft dark:fill-signal/10" />
				<circle cx="84" cy="84" r="18" className="fill-inverse dark:fill-signal" />
				<text
					x="84"
					y="84"
					textAnchor="middle"
					dominantBaseline="central"
					className="fill-inverse-foreground font-display text-[11px] font-semibold dark:fill-primary-foreground"
				>
					{vocab.sun}
				</text>
			</svg>
			<div>
				<p className="font-display text-[17px]">{vocab.empty.title}</p>
				<p className="mx-auto mt-1 max-w-[340px] text-[13px] text-ink-2">
					{vocab.empty.body}
				</p>
			</div>
		</div>
	);
}
