"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import type { SenderStat } from "@/lib/insights/types";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { senderValue, type OrbitCategory, type WeekIndex } from "./layout";
import { displayName, formatCount, plural } from "./format";
import { capitalize, type OrbitVocab } from "./vocab";

const PREVIEW_ROWS = 8;
/** Phones preview fewer; CSS hides the rest, so server and client render the same rows. */
const PHONE_ROWS = 5;

export function OrbitList({
	senders,
	categories,
	week,
	now,
	vocab,
	onOpen,
}: {
	senders: SenderStat[];
	categories: OrbitCategory[];
	week: WeekIndex | null;
	now: number | null;
	vocab: OrbitVocab;
	onOpen: (id: string) => void;
}) {
	const [expanded, setExpanded] = React.useState(false);
	const ranked = React.useMemo(
		() =>
			senders
				.map((s, i) => ({ s, i, v: senderValue(s, week) }))
				.sort((a, b) => b.v - a.v || b.s.count - a.s.count || a.i - b.i),
		[senders, week],
	);
	const shown = expanded ? ranked : ranked.slice(0, PREVIEW_ROWS);
	const byShare = [...categories].sort((a, b) => b.value - a.value || a.order - b.order);
	const period = week === null ? vocab.window.all : vocab.window.week(week);

	return (
		<div className="@container flex flex-col gap-5">
			<CategoryBar categories={byShare} label={`${capitalize(vocab.mass)} by ${vocab.group[0]}, ${period}`} />
			<ol aria-label={`${capitalize(vocab.node[1])} ranked by ${vocab.mass}, ${period}`} className="flex flex-col gap-1">
				{shown.map(({ s, v }, idx) => (
					<li key={s.address} className={cn(!expanded && idx >= PHONE_ROWS && "max-sm:hidden")}>
						<Row sender={s} rank={idx + 1} value={v} week={week} now={now} vocab={vocab} onOpen={onOpen} />
					</li>
				))}
			</ol>
			{ranked.length > PHONE_ROWS && (
				<button
					type="button"
					onClick={() => setExpanded((x) => !x)}
					aria-expanded={expanded}
					className={cn(
						ranked.length <= PREVIEW_ROWS && "sm:hidden",
						"self-start rounded-pill px-3.5 py-2 text-[13px] text-ink-2 ring-1 ring-border transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none dark:ring-glass-border",
					)}
				>
					{expanded ? (
						<>
							Show top <span className="sm:hidden">{PHONE_ROWS}</span>
							<span className="max-sm:hidden">{PREVIEW_ROWS}</span>
						</>
					) : (
						`Show all ${ranked.length} ${vocab.node[1]}`
					)}
				</button>
			)}
		</div>
	);
}

function CategoryBar({ categories, label }: { categories: OrbitCategory[]; label: string }) {
	const total = categories.reduce((a, c) => a + c.value, 0);
	const summary = categories.map((c) => `${c.label} ${c.shareText}`).join(", ");
	return (
		<div>
			<div role="img" aria-label={`${label}: ${summary}`} className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-pill">
				{total > 0 &&
					categories.map((c, i) => (
						<span
							key={c.id}
							className="h-full transition-[flex-grow] duration-500"
							style={{
								flexGrow: c.value,
								flexBasis: 0,
								minWidth: c.value > 0 ? 3 : 0,
								background: `color-mix(in oklab, var(--orbit-cat-${c.tone}) ${Math.max(28, 100 - i * 12)}%, transparent)`,
							}}
						/>
					))}
			</div>
			<ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-ink-2" aria-hidden>
				{categories.map((c, i) => (
					<li key={c.id} className="inline-flex items-center gap-1.5">
						<span
							className="size-2 rounded-full"
							style={{ background: `color-mix(in oklab, var(--orbit-cat-${c.tone}) ${Math.max(28, 100 - i * 12)}%, transparent)` }}
						/>
						{c.label}
						<span className="tabular text-foreground">{c.shareText}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

function Row({
	sender,
	rank,
	value,
	week,
	now,
	vocab,
	onOpen,
}: {
	sender: SenderStat;
	rank: number;
	value: number;
	week: WeekIndex | null;
	now: number | null;
	vocab: OrbitVocab;
	onOpen: (id: string) => void;
}) {
	const person = sender.bucket === "people";
	const name = displayName(sender);
	const label = [
		`${rank}. ${name}`,
		week === null ? plural(value, vocab.unit[0], vocab.unit[1]) : `${plural(value, vocab.unit[0], vocab.unit[1])} in ${vocab.window.week(week)}`,
		`${formatCount(sender.unread)} ${vocab.flag.label}`,
		vocab.categoryLabel[sender.category],
		now === null ? null : vocab.recencyLong(sender, now),
	]
		.filter(Boolean)
		.join(", ");

	return (
		<button
			type="button"
			data-orbit-row={sender.address}
			onClick={() => onOpen(sender.address)}
			aria-label={label}
			className={cn(
				"group grid h-[52px] w-full items-center gap-2 rounded-[14px] px-2.5 text-left transition-colors duration-150 @xl:gap-3",
				// Every row is its own grid, so tracks are fixed or fractional (never auto) to keep columns aligned.
				"grid-cols-[1.25rem_2rem_minmax(0,1fr)_2.25rem_3.5rem]",
				"@xl:grid-cols-[1.5rem_2rem_minmax(0,1fr)_6.5rem_2.75rem_4.25rem_1rem]",
				"@3xl:grid-cols-[1.5rem_2rem_minmax(0,1.25fr)_minmax(6.5rem,0.55fr)_minmax(6.5rem,1fr)_3rem_4.5rem_4.5rem_1rem]",
				"hover:bg-sheet focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none dark:hover:bg-card-nested",
			)}
		>
			<span className="tabular font-mono text-[11px] text-ink-2">{rank}</span>
			<span
				className={cn(
					"grid size-8 place-items-center rounded-full font-mono text-[10px] font-semibold text-ink dark:text-inverse-foreground",
					person ? "bg-(--orbit-person)" : "bg-(--orbit-machine)",
				)}
			>
				{initials(sender.name, sender.address)}
			</span>
			<span className="min-w-0">
				<span className="block truncate text-[14px] leading-tight">{name}</span>
				<span className="block truncate text-[11.5px] text-ink-2">{sender.domain}</span>
			</span>
			<span className="hidden truncate text-[12px] text-ink-2 @xl:block">{vocab.categoryLabel[sender.category]}</span>
			<Spark daily={sender.daily} week={week} person={person} className="hidden h-5 w-full @3xl:block" />
			<span className={cn("tabular text-right font-display text-[16px]", value === 0 && "text-ink-2")}>{formatCount(value)}</span>
			<span className="flex justify-start">
				{sender.unread > 0 && (
					<span className="tabular rounded-pill bg-sheet px-2 py-0.5 text-[11px] whitespace-nowrap text-signal-ink ring-1 ring-signal/30 dark:bg-signal-soft dark:text-signal dark:ring-0">
						{sender.unread} {vocab.flag.chip}
					</span>
				)}
			</span>
			<span className="hidden text-right text-[12px] text-ink-2 @3xl:block">{now === null ? "" : vocab.ago(sender, now)}</span>
			<ChevronRight className="hidden size-4 text-ink-2 transition-transform duration-150 group-hover:translate-x-0.5 @xl:block" />
		</button>
	);
}

/** 30 daily bars; in week mode the chosen week stays lit. */
function Spark({ daily, week, person, className }: { daily: number[]; week: WeekIndex | null; person: boolean; className?: string }) {
	const n = daily.length || 1;
	const max = Math.max(1, ...daily);
	const W = 104;
	const H = 20;
	const bw = W / n;
	const start = week === null ? -1 : n - 28 + week * 7;
	return (
		<svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-hidden>
			{daily.map((v, i) => {
				const h = v > 0 ? Math.max(2, (v / max) * H) : 1;
				const inWeek = week === null || (i >= start && i < start + 7);
				return (
					<rect
						key={i}
						x={i * bw + 0.5}
						y={H - h}
						width={Math.max(1, bw - 1.2)}
						height={h}
						rx={0.8}
						className={person ? "fill-signal dark:fill-orb-4" : "fill-ink-2 dark:fill-orb-1"}
						opacity={v === 0 ? 0.25 : inWeek ? 0.95 : 0.22}
					/>
				);
			})}
		</svg>
	);
}
