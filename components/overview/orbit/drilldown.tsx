"use client";

import * as React from "react";
import Link from "next/link";
import {
	ArrowLeft,
	ArrowRight,
	ArrowUpRight,
	Clock3,
	MailOpen,
	MessagesSquare,
	MoonStar,
	Reply,
	Sun,
} from "lucide-react";
import type { SenderStat, ThreadRef } from "@/lib/insights/types";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import {
	CATEGORY_LABEL,
	ROW_GAP,
	ROW_H,
	ROWS_HEADER,
	activityTicks,
	fanCurve,
	panelTop,
	stackRows,
	ticksPath,
	type FocusCardId,
	type FocusLayout,
} from "./layout";
import {
	dayPart,
	displayName,
	firstName,
	formatAge,
	formatAgo,
	formatClock,
	formatCount,
	formatDuration,
	formatStamp,
	formatUtcOffset,
	localHour,
	plural,
	threadHref,
} from "./format";
import type { FocusCardSpec, OrbitFocus } from "./vocab";

const EASE = "var(--ease-out-quint)";
const HOUR = 3_600_000;

export function focusCards(s: SenderStat): FocusCardId[] {
	const base: FocusCardId[] = ["threads", "unread", "reply", "last"];
	return s.tzOffsetMin === undefined ? base : [...base, "local"];
}

type Card = FocusCardSpec;

function cardFor(id: FocusCardId, s: SenderStat, now: number | null): Card {
	const first = firstName(s);
	switch (id) {
		case "threads":
			return { id, icon: MessagesSquare, value: formatCount(s.count), label: "Threads", spoken: `${plural(s.count, "thread")}` };
		case "unread":
			return { id, icon: MailOpen, value: formatCount(s.unread), label: "Unread", spoken: `${formatCount(s.unread)} unread` };
		case "reply": {
			const v = formatDuration(s.yourReplyMedianMin);
			return {
				id,
				icon: Reply,
				value: v,
				label: "Your reply time",
				spoken: v === "—" ? "your reply time unknown" : `you usually reply in ${v}`,
			};
		}
		case "last": {
			const v = now === null ? "—" : formatAgo(s.lastAt, now);
			return { id, icon: Clock3, value: v, label: "Last contact", spoken: `last contact ${v}` };
		}
		case "local": {
			const tz = s.tzOffsetMin ?? 0;
			const night = now !== null && dayPart(localHour(now, tz)) === "night";
			const v = now === null ? "—" : formatClock(now, tz);
			return { id, icon: night ? MoonStar : Sun, value: v, label: `for ${first}`, spoken: `${first}'s local time ${v}` };
		}
	}
}

export function describeSender(s: SenderStat, now: number | null): string {
	return focusCards(s)
		.map((id) => cardFor(id, s, now).spoken)
		.join(", ");
}

/** Mail's drilldown: threads, unread, reply rhythm, last contact, local time. */
export const MAIL_FOCUS: OrbitFocus = {
	cards: (s, now) => focusCards(s).map((id) => cardFor(id, s, now)),
	rows: (s, now) =>
		s.recent.slice(0, 5).map((ref) => ({ key: `${ref.folder}:${ref.uid}`, node: <ThreadRow thread={ref} now={now} /> })),
	rowsTitle: () => "Latest threads",
	rowsNote: (s) => (s.needsReply > 0 ? `${s.needsReply} ${s.needsReply === 1 ? "needs" : "need"} your reply` : null),
	emptyRows: "No recent threads in this window.",
	panel: (s, id, now) => <MailPanel sender={s} selected={id} now={now} />,
	panelHeight: { unread: 210, reply: 220, last: 244, local: 150 },
	chip: (s) => `${CATEGORY_LABEL[s.category]} · ${s.bucket === "people" ? "Person" : "Service"}`,
	ringCaption: "30 days · 1 tick = 1 day",
};

type DrilldownProps = {
	sender: SenderStat;
	focus: OrbitFocus;
	/** "View all" under the rows. */
	more?: { label: string; onClick: () => void };
	geom: FocusLayout;
	/** Draw our own orb (list view, or compact stages where the scene is hidden). */
	showOrb: boolean;
	now: number | null;
	reduced: boolean;
	returnTo: string;
	onBack: () => void;
	onAnnounce: (message: string) => void;
};

/** Takes focus on mount so Escape/Enter keep working after a drilldown opens. */
export function BackButton({ returnTo, onBack }: { returnTo: string; onBack: () => void }) {
	const ref = React.useRef<HTMLButtonElement>(null);
	React.useEffect(() => {
		ref.current?.focus({ preventScroll: true });
	}, []);
	return (
		<div className="flex items-center gap-2.5">
			<button
				ref={ref}
				type="button"
				onClick={onBack}
				className="inline-flex h-9 items-center gap-2 rounded-pill bg-sheet pr-4 pl-3 text-[13px] ring-1 ring-border transition-colors hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none dark:bg-card-nested dark:ring-glass-border dark:hover:bg-accent"
			>
				<ArrowLeft className="size-4" />
				Back to {returnTo}
			</button>
			<span className="hidden items-center gap-1.5 text-[11.5px] text-ink-2 sm:inline-flex">
				<Kbd>Esc</Kbd>
			</span>
		</div>
	);
}

export function Drilldown({ sender, focus, more, geom, showOrb, now, reduced, returnTo, onBack, onAnnounce }: DrilldownProps) {
	const cards = React.useMemo(() => focus.cards(sender, now), [focus, sender, now]);
	const rowsId = cards[0]?.id ?? "threads";
	const rows = React.useMemo(() => focus.rows(sender, now).slice(0, 5), [focus, sender, now]);
	const [selected, setSelected] = React.useState<FocusCardId>(rowsId);
	const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
	const kind = sender.bucket === "people" ? "person" : "machine";

	const select = (id: FocusCardId) => {
		setSelected(id);
		const card = cards.find((c) => c.id === id);
		if (card) onAnnounce(`${card.label}: ${card.value}.`);
	};

	const style = {
		["--node" as string]: `var(--orbit-${kind})`,
		["--node-gloss" as string]: `url(#${uid}-gloss)`,
	} as React.CSSProperties;

	const back = <BackButton returnTo={returnTo} onBack={onBack} />;

	if (geom.compact) {
		return (
			<section aria-label={`${displayName(sender)} details`} className="flex flex-col gap-4" style={style}>
				{back}
				<div className="flex items-center gap-4">
					<svg width={geom.height} height={geom.height} className="shrink-0" aria-hidden>
						<FocusDefs uid={uid} />
						<ActivityRing sender={sender} geom={geom} uid={uid} showOrb reduced={reduced} />
					</svg>
					<Identity sender={sender} className="min-w-0 text-left" />
				</div>
				<div className="grid grid-cols-2 gap-2">
					{cards.map((card, i) => (
						<StatCard
							key={card.id}
							card={card}
							selected={selected === card.id}
							onSelect={select}
							reduced={reduced}
							delay={200 + i * 50}
							compact
							className={cn("h-[60px]", cards.length % 2 === 1 && i === cards.length - 1 && "col-span-2")}
						/>
					))}
				</div>
				<Detail focus={focus} sender={sender} selected={selected} rowsId={rowsId} rows={rows} more={more} now={now} reduced={reduced} compact />
			</section>
		);
	}

	const selectedCard = geom.cards.find((c) => c.id === selected) ?? geom.cards[0]!;
	// The "View all" button takes one row slot so the stack stays inside the stage.
	const stack = stackRows(geom.detail, rows.length + (more ? 1 : 0));
	const from = { x: selectedCard.x + selectedCard.w + 2, y: selectedCard.cy };
	const panelY = panelTop(geom.detail, selectedCard.cy, focus.panelHeight[selected] ?? 240);
	const detailCurves =
		selected === rowsId
			? stack.centers.slice(0, rows.length).map((y) => fanCurve(from, { x: geom.detail.x - 4, y }))
			: [fanCurve(from, { x: geom.detail.x - 4, y: panelY + 28 })];

	return (
		<section aria-label={`${displayName(sender)} details`} className="absolute inset-0" style={style}>
			<svg width={geom.width} height={geom.height} className="pointer-events-none absolute inset-0" aria-hidden>
				<FocusDefs uid={uid} />
				<ActivityRing sender={sender} geom={geom} uid={uid} showOrb={showOrb} reduced={reduced} />
				<g fill="none" strokeLinecap="round">
					{geom.curves.map((d, i) => {
						const on = geom.cards[i]?.id === selected;
						return (
							<path
								key={i}
								d={d}
								pathLength={1}
								className={cn(
									"transition-[stroke,stroke-width] duration-300",
									on ? "stroke-signal" : "stroke-ink-3/80 dark:stroke-beam-2/35",
								)}
								strokeWidth={on ? 1.6 : 1}
								style={drawStyle(reduced, 420 + i * 70, 620)}
							/>
						);
					})}
				</g>
				{!reduced && <Sparks paths={geom.curves} delay={420} stagger={70} dur={620} />}
			</svg>

			<svg
				key={`fan-${selected}`}
				width={geom.width}
				height={geom.height}
				className="pointer-events-none absolute inset-0"
				aria-hidden
			>
				<g fill="none" strokeLinecap="round">
					{detailCurves.map((d, i) => (
						<path
							key={i}
							d={d}
							pathLength={1}
							className="stroke-signal/70 dark:stroke-signal/60"
							strokeWidth={1.1}
							style={drawStyle(reduced, 760 + i * 60, 560)}
						/>
					))}
				</g>
				{!reduced && <Sparks paths={detailCurves} delay={760} stagger={60} dur={560} />}
			</svg>

			<div className="absolute top-0 left-0">{back}</div>

			<Identity
				sender={sender}
				className="absolute w-[260px] -translate-x-1/2 text-center"
				style={{ left: geom.orb.x, top: Math.max(44, geom.orb.y - geom.ring.outer - 66) }}
			/>
			<div
				className="absolute flex -translate-x-1/2 flex-col items-center gap-2"
				style={{ left: geom.orb.x, top: geom.orb.y + geom.ring.outer + 14 }}
			>
				<span className="inline-flex h-6 items-center gap-1.5 rounded-pill bg-sheet px-2.5 text-[11.5px] ring-1 ring-border dark:bg-card-nested dark:ring-glass-border">
					<span className="size-1.5 rounded-full bg-(--node)" />
					{focus.chip(sender)}
				</span>
				<p className="readout text-[10px]">{focus.ringCaption}</p>
			</div>

			{geom.cards.map((pos, i) => {
				const card = cards.find((c) => c.id === pos.id)!;
				return (
					<StatCard
						key={card.id}
						card={card}
						selected={selected === card.id}
						onSelect={select}
						reduced={reduced}
						delay={520 + i * 70}
						className="absolute"
						style={{ left: pos.x, top: pos.y, width: pos.w, height: pos.h }}
					/>
				);
			})}

			<div
				key={`detail-${selected}`}
				className="absolute"
				style={{ left: geom.detail.x, top: selected === rowsId ? stack.top : panelY, width: geom.detail.w }}
			>
				<Detail focus={focus} sender={sender} selected={selected} rowsId={rowsId} rows={rows} more={more} now={now} reduced={reduced} />
			</div>
		</section>
	);
}

function drawStyle(reduced: boolean, delay: number, dur: number): React.CSSProperties | undefined {
	if (reduced) return undefined;
	return {
		strokeDasharray: 1,
		strokeDashoffset: 1,
		animation: `draw ${dur}ms ${EASE} ${delay}ms forwards`,
	};
}

function riseStyle(reduced: boolean, delay: number): React.CSSProperties | undefined {
	if (reduced) return undefined;
	return { animation: `rise-in 420ms ${EASE} ${delay}ms backwards` };
}

function FocusDefs({ uid }: { uid: string }) {
	return (
		<defs>
			<radialGradient id={`${uid}-gloss`} cx="0.4" cy="0.36" r="0.72" fx="0.32" fy="0.26">
				<stop offset="0" style={{ stopColor: "color-mix(in oklab, var(--node) 30%, white)" }} />
				<stop offset="0.45" style={{ stopColor: "var(--node)" }} />
				<stop offset="1" style={{ stopColor: "color-mix(in oklab, var(--node) 52%, black)" }} />
			</radialGradient>
			<radialGradient id={`${uid}-halo`}>
				<stop offset="0.3" style={{ stopColor: "var(--node)", stopOpacity: 0 }} />
				<stop offset="0.5" style={{ stopColor: "var(--node)", stopOpacity: 0.16 }} />
				<stop offset="1" style={{ stopColor: "var(--node)", stopOpacity: 0 }} />
			</radialGradient>
		</defs>
	);
}

/** The data-true version of the reference's waveform ring: one tick per day. */
function ActivityRing({
	sender,
	geom,
	uid,
	showOrb,
	reduced,
}: {
	sender: SenderStat;
	geom: FocusLayout;
	uid: string;
	showOrb: boolean;
	reduced: boolean;
}) {
	const { orb, ring } = geom;
	const ticks = activityTicks(sender.daily, orb.x, orb.y, ring.inner, ring.maxLen);
	const d = ticksPath(ticks);
	const busiest = ticks.reduce((best, t) => (t.value > best.value ? t : best), ticks[0] ?? { value: 0, x2: 0, y2: 0 });
	return (
		<g>
			<circle cx={orb.x} cy={orb.y} r={ring.outer + 26} fill={`url(#${uid}-halo)`} className="hidden dark:inline" />
			<circle
				cx={orb.x}
				cy={orb.y}
				r={ring.inner - 3.5}
				fill="none"
				className="stroke-border dark:stroke-glass-border"
				strokeWidth={1}
			/>
			<path
				d={d}
				pathLength={1}
				fill="none"
				strokeLinecap="round"
				strokeWidth={2.4}
				className="stroke-signal dark:stroke-(--node)"
				style={drawStyle(reduced, 260, 900)}
			/>
			{busiest.value > 0 && (
				<circle
					cx={busiest.x2}
					cy={busiest.y2}
					r={2.6}
					className="fill-foreground"
					style={riseStyle(reduced, 1100)}
				/>
			)}
			{showOrb && (
				<g className="origin-center [transform-box:fill-box]" style={reduced ? undefined : { animation: `bloom 700ms ${EASE} both` }}>
					<circle
						cx={orb.x}
						cy={orb.y}
						r={orb.r}
						strokeWidth={1}
						className={cn(
							"fill-(--node) dark:fill-(--node-gloss) dark:stroke-none",
							sender.bucket === "people" ? "stroke-orb-1/70" : "stroke-ink-2/60",
							"dark:drop-shadow-[0_0_12px_color-mix(in_oklab,var(--node)_55%,transparent)]",
						)}
					/>
				</g>
			)}
		</g>
	);
}

/** One spark rides each curve as it draws (Nebula only). Fresh <svg> ⇒ SMIL begins at mount. */
function Sparks({ paths, delay, stagger, dur }: { paths: string[]; delay: number; stagger: number; dur: number }) {
	return (
		<g className="hidden dark:inline">
			{paths.map((d, i) => {
				const begin = `${(delay + i * stagger) / 1000}s`;
				return (
					<g key={i} opacity={0}>
						<circle r={4} className="fill-signal" opacity={0.3} />
						<circle r={1.5} fill="#fff8e6" />
						<animateMotion dur={`${dur}ms`} begin={begin} path={d} calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines="0.23 1 0.32 1" fill="freeze" />
						<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.75;1" dur={`${dur + 260}ms`} begin={begin} fill="freeze" />
					</g>
				);
			})}
		</g>
	);
}

function Identity({ sender, className, style }: { sender: SenderStat; className?: string; style?: React.CSSProperties }) {
	return (
		<div className={className} style={style}>
			<h3 className="truncate font-display text-[20px] leading-tight tracking-[-0.01em]">{displayName(sender)}</h3>
			<p className="mt-1 truncate font-mono text-[11.5px] text-ink-2">{sender.address}</p>
		</div>
	);
}

function StatCard({
	card,
	selected,
	onSelect,
	reduced,
	delay,
	compact = false,
	className,
	style,
}: {
	card: Card;
	selected: boolean;
	onSelect: (id: FocusCardId) => void;
	reduced: boolean;
	delay: number;
	compact?: boolean;
	className?: string;
	style?: React.CSSProperties;
}) {
	const Icon = card.icon;
	return (
		<button
			type="button"
			data-orbit-card={card.id}
			aria-label={card.spoken.charAt(0).toUpperCase() + card.spoken.slice(1)}
			aria-pressed={selected}
			onClick={() => onSelect(card.id)}
			className={cn(
				"group flex items-center rounded-[16px] text-left transition-[background-color,box-shadow,color] duration-200",
				compact ? "gap-2.5 px-3" : "gap-3 px-3.5",
				"focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none",
				selected
					? "bg-inverse text-inverse-foreground shadow-lift dark:bg-signal-soft dark:text-foreground dark:shadow-glow"
					: "bg-sheet ring-1 ring-border hover:ring-foreground/25 dark:bg-card-nested dark:ring-glass-border dark:hover:ring-signal/35",
				className,
			)}
			style={{ ...style, ...riseStyle(reduced, delay) }}
		>
			<span
				className={cn(
					"grid shrink-0 place-items-center rounded-full",
					compact ? "size-7" : "size-8",
					selected ? "bg-white/12 dark:bg-signal/15 dark:text-signal" : "bg-card text-ink-2 dark:bg-background/50",
				)}
			>
				<Icon className="size-4" />
			</span>
			<span className="min-w-0">
				<span className="tabular block truncate font-display text-[20px] leading-none tracking-[-0.02em]">{card.value}</span>
				<span className={cn("mt-1 block truncate text-[12px]", selected ? "opacity-75" : "text-ink-2")}>{card.label}</span>
			</span>
		</button>
	);
}

function Detail({
	focus,
	sender,
	selected,
	rowsId,
	rows,
	more,
	now,
	reduced,
	compact = false,
}: {
	focus: OrbitFocus;
	sender: SenderStat;
	selected: FocusCardId;
	rowsId: FocusCardId;
	rows: { key: string; node: React.ReactNode }[];
	more?: { label: string; onClick: () => void };
	now: number | null;
	reduced: boolean;
	compact?: boolean;
}) {
	if (selected === rowsId) {
		const note = focus.rowsNote(sender);
		return (
			<div>
				<div className="flex items-center justify-between gap-3" style={{ height: ROWS_HEADER }}>
					<p className="readout">{focus.rowsTitle(sender)}</p>
					{note && <p className="text-[12px] text-signal-ink dark:text-signal">{note}</p>}
				</div>
				{rows.length === 0 ? (
					<p className="rounded-[14px] bg-sheet px-4 py-3 text-[13px] text-ink-2 ring-1 ring-border dark:bg-card-nested dark:ring-glass-border">
						{focus.emptyRows}
					</p>
				) : (
					<ul className="flex flex-col" style={{ gap: ROW_GAP }}>
						{rows.map((row, i) => (
							<li key={row.key} style={{ height: ROW_H, ...riseStyle(reduced, (compact ? 260 : 820) + i * 60) }}>
								{row.node}
							</li>
						))}
					</ul>
				)}
				{more && (
					<button
						type="button"
						onClick={more.onClick}
						className="group mt-2 inline-flex h-9 items-center gap-2 rounded-pill px-4 text-[13px] text-ink-2 ring-1 ring-border transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none dark:ring-glass-border dark:hover:ring-signal/40"
						style={riseStyle(reduced, (compact ? 260 : 820) + rows.length * 60)}
					>
						{more.label}
						<ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
					</button>
				)}
			</div>
		);
	}

	return (
		<div
			className="glass-thin rounded-[20px] p-5 shadow-lift"
			style={riseStyle(reduced, compact ? 120 : 780)}
		>
			{focus.panel(sender, selected, now)}
		</div>
	);
}

function MailPanel({ sender, selected, now }: { sender: SenderStat; selected: FocusCardId; now: number | null }) {
	const first = firstName(sender);
	return (
		<>
			{selected === "unread" && (
				<>
					<p className="readout">Unread from {first}</p>
					<p className="tabular mt-2 font-display text-[34px] leading-none">{formatCount(sender.unread)}</p>
					<p className="mt-2 text-[13px] text-ink-2">
						{sender.needsReply > 0
							? `${sender.needsReply} ${sender.needsReply === 1 ? "is waiting" : "are waiting"} on your reply.`
							: "Nothing is waiting on your reply."}
					</p>
					{sender.recent[0] && (
						<Link
							href={threadHref(sender.recent[0])}
							className="mt-4 flex items-center gap-2 text-[13px] text-signal-ink hover:underline dark:text-signal"
						>
							<span className="truncate">Open latest: {sender.recent[0].subject}</span>
							<ArrowUpRight className="size-3.5 shrink-0" />
						</Link>
					)}
				</>
			)}
			{selected === "reply" && <ReplyDetail sender={sender} first={first} />}
			{selected === "last" && (
				<>
					<p className="readout">Last contact</p>
					<p className="mt-2 font-display text-[28px] leading-none">{now === null ? "—" : formatAgo(sender.lastAt, now)}</p>
					<p className="mt-1.5 text-[13px] text-ink-2">{formatStamp(sender.lastAt)}</p>
					<WeeklyBars weekly={sender.weekly} />
				</>
			)}
			{selected === "local" && sender.tzOffsetMin !== undefined && (
				<LocalDetail tz={sender.tzOffsetMin} now={now} first={first} />
			)}
		</>
	);
}

function ThreadRow({ thread, now }: { thread: ThreadRef; now: number | null }) {
	const age = now === null ? thread.ageHours : Math.max(0, (now - Date.parse(thread.date)) / HOUR);
	return (
		<Link
			href={threadHref(thread)}
			className="group flex h-full items-center gap-3 rounded-[14px] bg-sheet px-3.5 ring-1 ring-border transition-[box-shadow,background-color] duration-200 hover:ring-foreground/25 focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none dark:bg-card-nested dark:ring-glass-border dark:hover:ring-signal/40"
		>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-[13.5px] leading-tight">{thread.subject || "(no subject)"}</span>
				<span className="mt-0.5 block truncate text-[11.5px] text-ink-2">
					{thread.folder === "INBOX" ? "Inbox" : thread.folder} · {formatStamp(thread.date)}
				</span>
			</span>
			<span className="tabular shrink-0 font-mono text-[11px] text-ink-2">{formatAge(age)}</span>
			<ArrowUpRight className="size-3.5 shrink-0 text-ink-2 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
		</Link>
	);
}

function ReplyDetail({ sender, first }: { sender: SenderStat; first: string }) {
	const yours = sender.yourReplyMedianMin;
	const theirs = sender.theirReplyMedianMin;
	const max = Math.max(yours ?? 0, theirs ?? 0, 1);
	const verdict =
		yours === null || theirs === null
			? "Not enough back-and-forth yet to compare."
			: yours <= theirs
				? `You usually answer ${first} faster than they answer you.`
				: `${first} usually answers faster than you do.`;
	return (
		<>
			<p className="readout">Reply rhythm</p>
			<dl className="mt-3 space-y-3">
				{[
					{ who: "You", v: yours },
					{ who: first, v: theirs },
				].map(({ who, v }) => (
					<div key={who}>
						<div className="flex items-baseline justify-between gap-3 text-[13px]">
							<dt className="truncate text-ink-2">{who}</dt>
							<dd className="tabular font-display text-[17px]">{formatDuration(v)}</dd>
						</div>
						<div className="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-foreground/8">
							<div
								className={cn("h-full rounded-pill", who === "You" ? "bg-signal" : "bg-(--node)")}
								style={{ width: v === null ? 0 : `${Math.max(4, (v / max) * 100)}%` }}
							/>
						</div>
					</div>
				))}
			</dl>
			<p className="mt-3 text-[13px] text-ink-2">
				{verdict}
				{sender.sentToThem > 0 && ` You've written ${plural(sender.sentToThem, "email")} to ${first}.`}
			</p>
		</>
	);
}

function WeeklyBars({ weekly }: { weekly: number[] }) {
	const weeks = [0, 1, 2, 3].map((i) => weekly[i] ?? 0);
	const max = Math.max(1, ...weeks);
	return (
		<div className="mt-4">
			<p className="readout">Per week</p>
			<ul className="mt-2 grid grid-cols-4 items-end gap-2" style={{ height: 64 }}>
				{weeks.map((v, i) => (
					<li key={i} className="flex h-full flex-col items-center justify-end gap-1">
						<span className="tabular font-mono text-[10.5px] text-ink-2">{v}</span>
						<span
							className={cn("w-full rounded-[4px]", i === 3 ? "bg-signal" : "bg-foreground/15 dark:bg-foreground/20")}
							style={{ height: `${Math.max(3, (v / max) * 36)}px` }}
						/>
						<span className="font-mono text-[10px] text-ink-2">W{i + 1}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

function LocalDetail({ tz, now, first }: { tz: number; now: number | null; first: string }) {
	if (now === null) return <p className="readout">Their local time</p>;
	const part = dayPart(localHour(now, tz));
	const note = {
		night: `Late for ${first} — a reply now lands after hours.`,
		morning: `Early morning for ${first}.`,
		working: `Working hours for ${first}.`,
		evening: `Evening for ${first}.`,
	}[part];
	return (
		<>
			<p className="readout">Their local time</p>
			<p className="tabular mt-2 font-display text-[34px] leading-none">{formatClock(now, tz)}</p>
			<p className="mt-2 text-[13px] text-ink-2">
				{formatUtcOffset(tz)} · {note}
			</p>
		</>
	);
}
