"use client";

import type * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Check, CornerDownRight, ThumbsDown, ThumbsUp } from "lucide-react";
import { useAskStore, type AskTurn } from "@/components/jev/ask-store";
import type { AskOptions } from "@/components/jev/use-ask";
import { INTENT_META } from "@/lib/jev/ask/catalog";
import { formatAge, mailLink } from "@/lib/jev/ask/format";
import type { AskAnswer, AskStage, Evidence } from "@/lib/jev/ask/types";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const STAGES: { stage: AskStage; label: string }[] = [
	{ stage: "understand", label: "Understanding" },
	{ stage: "search", label: "Searching" },
	{ stage: "rank", label: "Ranking" },
	{ stage: "answer", label: "Answering" },
];

const SOURCE: Record<AskAnswer["plan"]["source"], string> = {
	jev: "Jev",
	heuristic: "Keywords",
	forced: "Suggested",
};

type AskFn = (question: string, options?: AskOptions) => void;

function Chip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-card-nested px-3 text-[12px] text-foreground ring-1 ring-border transition-colors hover:bg-signal-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:ring-glass-border"
		>
			{children}
		</button>
	);
}

export function StageTrail({ turn }: { turn: AskTurn }) {
	const order = new Map(STAGES.map((s, i) => [s.stage, i]));
	const label = new Map(STAGES.map((s) => [s.stage, s.label]));
	const reached = turn.stages.length ? turn.stages : [{ stage: "understand" as const, detail: "Reading your question" }];
	const sorted = [...reached].sort((a, b) => order.get(a.stage)! - order.get(b.stage)!);
	return (
		<ol className="space-y-1.5" aria-label="Jev progress">
			{sorted.map(({ stage, detail }, i) => {
				const active = turn.status === "running" && i === sorted.length - 1;
				return (
					<li key={stage} className="flex items-center gap-2.5 text-[13px]">
						<span
							className={cn(
								"grid size-4 shrink-0 place-items-center rounded-full",
								active ? "ring-1 ring-signal/60" : "bg-signal text-white dark:text-inverse-foreground",
							)}
						>
							{active ? (
								<span className="size-1.5 animate-pulse rounded-full bg-signal" />
							) : (
								<Check className="size-2.5" strokeWidth={3} />
							)}
						</span>
						<span className={cn("shrink-0 font-medium", active && "shimmer")}>{label.get(stage)}</span>
						<span className="truncate text-ink-2">{detail}</span>
					</li>
				);
			})}
		</ol>
	);
}

function Bars({ viz }: { viz: NonNullable<AskAnswer["viz"]> }) {
	const max = Math.max(1, ...viz.points.map((p) => p.value));
	const w = 100 / viz.points.length;
	const wide = viz.points.length <= 10;
	return (
		<figure className="mt-3">
			<svg viewBox="0 0 100 34" preserveAspectRatio="none" role="img" aria-label={`${viz.label}: ${viz.points.map((p) => `${p.label} ${p.value}`).join(", ")}`} className="h-20 w-full">
				{viz.points.map((p, i) => {
					const h = Math.max(1.5, (p.value / max) * 30);
					return (
						<rect
							key={`${p.label}-${i}`}
							x={i * w + w * 0.18}
							y={32 - h}
							width={w * 0.64}
							height={h}
							rx={Math.min(1.2, w * 0.3)}
							className={i === viz.points.length - 1 ? "fill-signal" : "fill-foreground/25"}
						/>
					);
				})}
			</svg>
			{wide ? (
				<div className="mt-1 flex justify-between gap-1 font-mono text-[10px] text-ink-2">
					{viz.points.map((p, i) => (
						<span key={`${p.label}-${i}`} className="min-w-0 flex-1 truncate text-center">
							{p.label}
						</span>
					))}
				</div>
			) : (
				<div className="mt-1 flex justify-between font-mono text-[10px] text-ink-2">
					<span>{viz.points[0]?.label}</span>
					<span>{viz.points[viz.points.length - 1]?.label}</span>
				</div>
			)}
		</figure>
	);
}

function EvidenceRow({
	item,
	glow,
	compact,
	onNavigate,
}: {
	item: Evidence;
	glow: boolean;
	compact?: boolean;
	onNavigate: () => void;
}) {
	return (
		<li>
			<Link
				href={mailLink(item)}
				onClick={onNavigate}
				className={cn(
					"group flex items-start gap-3 rounded-[16px] px-3 py-2.5 transition-colors hover:bg-card-nested focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
					glow && "glow-sweep [--card-sweep-fill:var(--popover)]",
					item.lowConfidence && "opacity-70",
					compact && "max-sm:gap-2.5 max-sm:rounded-[12px] max-sm:px-2 max-sm:py-1.5",
				)}
			>
				<span
					className={cn(
						"mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-card-nested font-mono text-[10px] font-semibold ring-1 ring-border dark:ring-glass-border",
						compact && "max-sm:size-7 max-sm:text-[9px]",
					)}
				>
					{initials(item.from.name, item.from.address)}
				</span>
				<span className="min-w-0 flex-1">
					<span className="flex items-baseline justify-between gap-2">
						<span className={cn("truncate text-[13px] font-medium", compact && "max-sm:text-[12px]")}>{item.from.name}</span>
						<span className={cn("shrink-0 font-mono text-[11px] tabular", item.critical ? "text-critical" : "text-ink-2")}>
							{item.badge ?? `${formatAge(item.ageHours)} ago`}
						</span>
					</span>
					<span className={cn("block truncate text-[13px]", compact && "max-sm:text-[12px]")}>{item.subject}</span>
					{item.preview && <span className="block truncate text-xs text-ink-2">{item.preview}</span>}
				</span>
				<ArrowUpRight className="mt-1 size-3.5 shrink-0 text-ink-3 transition-colors group-hover:text-foreground" />
			</Link>
		</li>
	);
}

export function AnswerCard({
	turn,
	onAsk,
	onNavigate,
	onFeedback,
	compact = false,
	}: {
		turn: AskTurn;
		onAsk: AskFn;
		onNavigate: () => void;
	/** Defaults to the Ask store; the landing's demo keeps its own turns. */
	onFeedback?: (id: string, feedback: "up" | "down") => void;
		/** Tighter padding and type below `sm`, for the landing's demo panel. */
		compact?: boolean;
	}) {
		const answer = turn.answer!;
	const storeFeedback = useAskStore((s) => s.setFeedback);
	const setFeedback = onFeedback ?? storeFeedback;
	const pct = Math.round(answer.confidence * 100);
	const firstCritical = answer.evidence.findIndex((e) => e.critical);
	const alternatives =
		!answer.clarify && answer.plan.source === "jev" && answer.confidence < 0.9 ? answer.plan.alternatives.slice(0, 2) : [];

	return (
		<article
			className={cn(
				"rounded-[20px] bg-popover/80 p-4 ring-1 ring-border dark:bg-card-nested dark:ring-glass-border",
				compact && "max-sm:rounded-[16px] max-sm:p-3",
			)}
		>
			<header className="flex items-start justify-between gap-3">
				<h3
					className={cn(
						"flex items-baseline gap-2 font-display text-[17px] leading-snug tracking-[-0.01em]",
						compact && "max-sm:gap-1.5 max-sm:text-[15px]",
					)}
				>
					<span aria-hidden className="font-mono text-base text-signal-ink dark:text-signal">
						[
					</span>
					{answer.headline}
				</h3>
				<div className="flex shrink-0 items-center gap-2 pt-1" title={`${SOURCE[answer.plan.source]} · ${pct}% sure`}>
					<span data-slot="source" className="font-mono text-[10px] tracking-[0.12em] text-ink-2 uppercase">{SOURCE[answer.plan.source]}</span>
					<span className="h-1 w-14 overflow-hidden rounded-full bg-border" aria-hidden>
						<span className="block h-full rounded-full bg-signal" style={{ width: `${pct}%` }} />
					</span>
					<span className="tabular font-mono text-[11px] text-ink-2">{pct}%</span>
				</div>
			</header>
			{answer.sentence && (
				<p className={cn("mt-1.5 pl-4 text-[13px] leading-relaxed text-ink-2", compact && "max-sm:mt-1 max-sm:text-[12px] max-sm:leading-normal")}>
					{answer.sentence}
				</p>
			)}

			{answer.viz && <Bars viz={answer.viz} />}

			{answer.stats && answer.stats.length > 0 && (
				<dl data-slot="stats" className={cn("mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3", compact && "max-sm:mt-2.5 max-sm:gap-1.5")}>
					{answer.stats.map((s) => (
						<div
							key={s.label}
							className={cn(
								"rounded-[14px] bg-card-nested px-3 py-2 ring-1 ring-border dark:ring-glass-border",
								compact && "max-sm:rounded-[12px] max-sm:px-2.5 max-sm:py-1.5",
							)}
						>
							<dt className="truncate text-[11px] text-ink-2">{s.label}</dt>
							<dd className={cn("tabular truncate font-display text-[15px]", compact && "max-sm:text-[14px]")}>{s.value}</dd>
						</div>
					))}
				</dl>
			)}

			{answer.evidence.length > 0 && (
				<ul data-slot="evidence" className={cn("mt-3 -mx-1 space-y-1", compact && "max-sm:mt-2 max-sm:space-y-0.5")}>
					{answer.evidence.map((item, i) => (
						<EvidenceRow
							key={`${item.folder}:${item.uid}`}
							item={item}
							glow={i === firstCritical}
							compact={compact}
							onNavigate={onNavigate}
						/>
					))}
				</ul>
			)}

			{answer.clarify && (
				<div className="mt-3">
					<p className="mb-2 text-[12px] text-ink-2">{answer.clarify.question}</p>
					<div className="flex flex-wrap gap-2">
						{answer.clarify.options.map((o) => (
							<Chip key={o.intent} onClick={() => onAsk(o.label, { forcedIntent: o.intent })}>
								{o.label}
							</Chip>
						))}
					</div>
				</div>
			)}

			{alternatives.length > 0 && (
				<div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
					Did you mean
					{alternatives.map((a) => (
						<Chip key={a.intent} onClick={() => onAsk(answer.question, { forcedIntent: a.intent })}>
							{INTENT_META[a.intent].label}
						</Chip>
					))}
				</div>
			)}

			<footer
				className={cn(
					"mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 dark:border-glass-border",
					compact && "max-sm:mt-2 max-sm:pt-2",
				)}
			>
				<p className="min-w-0 truncate font-mono text-[11px] text-ink-2">Searched: {answer.searched}</p>
				<div className="flex items-center gap-1">
					{answer.openInMail && (
						<Link
							href={answer.openInMail}
							onClick={onNavigate}
							className="mr-1 inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-[12px] text-signal-ink hover:bg-signal-soft dark:text-signal"
						>
							Open in Mail
							<ArrowUpRight className="size-3.5" />
						</Link>
					)}
					{(["up", "down"] as const).map((v) => {
						const Icon = v === "up" ? ThumbsUp : ThumbsDown;
						return (
							<button
								key={v}
								type="button"
								aria-label={v === "up" ? "Helpful" : "Not helpful"}
								aria-pressed={turn.feedback === v}
								onClick={() => setFeedback(turn.id, v)}
								className={cn(
									"grid size-7 place-items-center rounded-full text-ink-3 transition-colors hover:text-foreground",
									turn.feedback === v && "bg-signal-soft text-signal-ink dark:text-signal",
								)}
							>
								<Icon className="size-3.5" />
							</button>
						);
					})}
				</div>
			</footer>

			{answer.followUps.length > 0 && (
				<div data-slot="follow-ups" className="mt-3 flex flex-wrap gap-2">
					{answer.followUps.map((f) => (
						<Chip key={f} onClick={() => onAsk(f)}>
							<CornerDownRight className="size-3 text-ink-2" />
							{f}
						</Chip>
					))}
				</div>
			)}
		</article>
	);
}
