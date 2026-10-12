"use client";

import * as React from "react";
import Link from "next/link";
import { MoreHorizontal, Search, Sun, X } from "lucide-react";
import { Bento, BentoTitle } from "@/components/overview/bento";
import { Bars } from "@/components/viz/bars";
import { CountUp } from "@/components/viz/count-up";
import type { AskOptions } from "@/components/jev/use-ask";
import { formatAge, mailLink } from "@/lib/jev/ask/format";
import type { Overview } from "@/lib/insights/types";
import { cn } from "@/lib/utils";

const stripReplyPrefix = (subject: string) => subject.replace(/^(?:\s*(?:re|fwd?|aw|sv)\s*:\s*)+/i, "") || "(no subject)";

type Lens = "needs" | "newsletters";

/** Chips pick what to ask; the typed text narrows it. Free text alone goes through the normal planner. */
export function radarAsk(query: string, lens: Lens | null, today: boolean): [string, AskOptions?] | null {
	const q = query.trim();
	const when = today ? " today" : "";
	if (lens === "needs") return [q ? `${q} · needs my reply${when}` : `What needs my reply${when}?`, { forcedIntent: "needs_reply", filter: q }];
	// Newsletter stats span the whole sync window, so "today" doesn't apply.
	if (lens === "newsletters") return [q ? `${q} · newsletters` : "Newsletters I rarely open", { forcedIntent: "newsletters", filter: q }];
	if (q) return [`${q}${when}`];
	if (today) return ["What’s new today?", { forcedIntent: "unread_summary" }];
	return null;
}

/** The reference's "Activity manager": search + filter chips, today's pace, the busiest conversations, and the noise. */
export function ThreadsRadar({
	overview,
	onAsk,
	onReviewHygiene,
	i = 0,
}: {
	overview: Overview;
	onAsk: (question: string, options?: AskOptions) => void;
	onReviewHygiene: () => void;
	i?: number;
}) {
	const [query, setQuery] = React.useState("");
	const [lens, setLens] = React.useState<Lens | null>(null);
	const [todayOnly, setTodayOnly] = React.useState(false);
	const last14 = overview.volume.days.slice(-14);
	const today = overview.volume.days.at(-1);
	const rare = overview.newsletters.filter((n) => n.grade === "D" || n.grade === "F");
	const hot = overview.hotThreads.slice(0, 5);

	function submit(e: React.FormEvent) {
		e.preventDefault();
		const ask = radarAsk(query, lens, todayOnly && lens !== "newsletters");
		if (!ask) return;
		onAsk(...ask);
		setQuery("");
	}

	const chip = (label: string, on: boolean, onToggle: () => void, disabled = false) => {
		return (
			<button
				type="button"
				onClick={onToggle}
				aria-pressed={on}
				disabled={disabled}
				className={cn(
					"inline-flex h-8 items-center gap-1.5 rounded-pill px-3 text-[12px] ring-1 transition-colors disabled:opacity-40",
					on ? "bg-sheet text-foreground ring-border dark:bg-card-nested dark:ring-glass-border" : "text-ink-2 ring-border/60",
				)}
			>
				{label}
				{on ? <X className="size-3 text-ink-2" /> : <span className="size-1.5 rounded-full bg-ink-3" />}
			</button>
		);
	};

	return (
		<Bento i={i} className="flex flex-col gap-4">
			<div className="flex items-center justify-between gap-3">
				<BentoTitle>Threads radar</BentoTitle>
				<button
					type="button"
					aria-label="More"
					onClick={() => onAsk("What can you do?", { forcedIntent: "help" })}
					className="grid size-8 place-items-center rounded-full text-ink-2 ring-1 ring-border hover:text-foreground dark:ring-glass-border"
				>
					<MoreHorizontal className="size-4" />
				</button>
			</div>

			<form onSubmit={submit} className="flex flex-wrap items-center gap-2">
				<label className="relative min-w-[12rem] flex-1">
					<Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-2" />
					<span className="sr-only">Ask about threads</span>
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search in threads…"
						className="h-9 w-full rounded-pill bg-transparent pr-3 pl-9 text-[13px] outline-none ring-1 ring-border placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-ring dark:ring-glass-border"
					/>
				</label>
				{chip("Needs reply", lens === "needs", () => setLens(lens === "needs" ? null : "needs"))}
				{chip("Newsletters", lens === "newsletters", () => setLens(lens === "newsletters" ? null : "newsletters"))}
				{chip("Today", todayOnly && lens !== "newsletters", () => setTodayOnly(!todayOnly), lens === "newsletters")}
			</form>

			<div className="grid flex-1 gap-3 sm:grid-cols-3 xl:grid-cols-2 wide:grid-cols-3">
				<div className="flex flex-col rounded-[20px] bg-card-nested p-4 dark:ring-1 dark:ring-glass-border">
					<p className="flex items-baseline gap-1.5">
						<CountUp value={today?.received ?? 0} className="font-display text-kpi-sm" />
						<span className="text-[12px] text-ink-2">today</span>
					</p>
					<Bars values={last14.map((d) => d.received)} label={`Received per day, last 14 days: ${last14.map((d) => d.received).join(", ")}`} className="mt-4 min-h-18 flex-1" fill />
					<p className="mt-2 font-mono text-[10px] text-ink-3">last 14 days</p>
				</div>

				<div className="flex min-w-0 flex-col rounded-[20px] bg-card-nested p-4 dark:ring-1 dark:ring-glass-border">
					<p className="text-[13px] font-medium">Hot threads</p>
					<p className="text-[11px] text-ink-2">Most messages this week</p>
					{hot.length === 0 ? (
						<p className="mt-3 text-[12px] text-ink-2">No busy conversations this week.</p>
					) : (
						<ol className="relative mt-3 space-y-3 before:absolute before:top-3 before:bottom-3 before:left-2.75 before:w-px before:bg-border dark:before:bg-glass-border">
							{hot.map((t) => (
								<li key={`${t.folder}:${t.uid}`}>
									<Link
										href={mailLink(t)}
										className="group relative flex items-start gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										<span
											className="grid size-[23px] shrink-0 place-items-center rounded-full bg-signal font-mono text-[10px] font-semibold text-white tabular dark:text-inverse-foreground"
											aria-label={`${t.messages} messages`}
										>
											{t.messages}
										</span>
										<span className="min-w-0 flex-1">
											<span className="line-clamp-2 text-[13px] leading-snug group-hover:underline">{stripReplyPrefix(t.subject)}</span>
											<span className="block truncate text-[11px] text-ink-2">
												{t.people.join(", ")} · {formatAge(t.ageHours)}
											</span>
										</span>
									</Link>
								</li>
							))}
						</ol>
					)}
				</div>

				{/* 1280–1399px: the radar is too narrow for three columns, so this card drops to its own full-width row, laid out horizontally. */}
				<div className="flex flex-col rounded-[20px] bg-card-nested p-4 xl:col-span-2 xl:max-wide:flex-row xl:max-wide:items-center xl:max-wide:gap-5 wide:col-span-1 dark:ring-1 dark:ring-glass-border">
					<Sun className="size-8 shrink-0 text-signal" strokeWidth={1.25} aria-hidden />
					<div className="mt-3 xl:max-wide:mt-0 xl:max-wide:min-w-0 xl:max-wide:flex-1">
						<p className="text-[13px] font-medium">Quiet the noise</p>
						<p className="mt-1 text-[12px] leading-snug text-ink-2">
							{rare.length
								? `${rare.length} ${rare.length === 1 ? "newsletter you rarely open" : "newsletters you rarely open"}.`
								: "Every list you get, you actually open."}
						</p>
					</div>
					{rare.length > 0 && (
						<ul className="mt-3 mb-4 space-y-1 xl:max-wide:my-0 xl:max-wide:w-52 xl:max-wide:shrink-0">
							{rare.slice(0, 3).map((n) => (
								<li key={n.key} className="flex items-baseline justify-between gap-2 text-[12px]">
									<span className="truncate">{n.name}</span>
									<span className="tabular shrink-0 font-mono text-[11px] text-ink-2">{Math.round(n.openRate * 100)}%</span>
								</li>
							))}
						</ul>
					)}
					<button
						type="button"
						onClick={onReviewHygiene}
						className="mt-auto h-9 shrink-0 rounded-pill bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-[box-shadow] hover:shadow-glow xl:max-wide:mt-0 xl:max-wide:px-6"
					>
						Review
					</button>
				</div>
			</div>
		</Bento>
	);
}
