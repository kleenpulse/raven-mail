"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Gauge, Loader2, Play, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { Bento, BentoTitle } from "@/components/overview/bento";
import { formatAgo } from "@/components/overview/orbit/format";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useNow } from "@/hooks/use-now";
import { readApiError, toApiError } from "@/lib/api-error";
import type { EngineMetrics, EvalCase, EvalEngine, EvalSplit, KageEvalReport, Rate } from "@/lib/dev/kage-eval";
import { cn } from "@/lib/utils";
import { LayoutScroll } from "@/components/ui/layout-scroll";

const ENGINE_LABEL: Record<EvalEngine, string> = { heuristic: "Keywords", kage: "Kage", jev: "Jev" };

const SPLIT_META: Record<EvalSplit, { label: string; note: string }> = {
	blind: { label: "Blind", note: "Written after tuning stopped. The honest number." },
	holdout: { label: "Holdout", note: "Used once to diagnose misses, so slightly optimistic." },
	dev: { label: "Dev", note: "Kage was tuned against these. Expect it to look good." },
};
const SPLIT_ORDER: EvalSplit[] = ["blind", "holdout", "dev"];

/**
 * Barrel roll: the notes are faces of a cube turning on its long axis. Each
 * face is one 20px line and the axis sits half a line behind it, so a face
 * turned 90° lands exactly where the next line would be: mid-roll the two
 * meet at an edge and never overlap. No extra translate; the rotation alone
 * carries them. `dir` is the tab's travel (1 = rightwards, rolls up; -1 down).
 * Transform and opacity only; MotionConfig makes it a crossfade under reduced
 * motion.
 */
const ROLL_LINE = 20;
// One clock and curve for both faces, so they turn as a single solid.
const ROLL = { duration: 0.5, ease: [0.65, 0, 0.35, 1] } as const;
const roll: Variants = {
	enter: (dir: number) => ({ rotateX: dir * -90, opacity: 0.4 }),
	center: { rotateX: 0, opacity: 1, transition: ROLL },
	exit: (dir: number) => ({ rotateX: dir * 90, opacity: 0.4, transition: ROLL }),
};

function SplitNote({ split, dir }: { split: EvalSplit; dir: number }) {
	return (
		<p className="min-w-0 text-[13px] text-ink-2">
			<span className="sr-only" aria-live="polite">
				{SPLIT_META[split].note}
			</span>
			{/* One grid cell for every note in flight, a little taller than a line so the
			    cube's corners clear it; the soft mask hides them as they swing past. */}
			<span
				aria-hidden
				className="grid h-8 items-center overflow-hidden [perspective:500px] mask-[linear-gradient(to_bottom,transparent,black_22%,black_78%,transparent)]"
			>
				<AnimatePresence initial={false} custom={dir}>
					<motion.span
						key={split}
						custom={dir}
						variants={roll}
						initial="enter"
						animate="center"
						exit="exit"
						style={{
							lineHeight: `${ROLL_LINE}px`,
							transformOrigin: `50% 50% -${ROLL_LINE / 2}px`,
							backfaceVisibility: "hidden",
							willChange: "transform, opacity",
						}}
						className="col-start-1 row-start-1 truncate"
					>
						{SPLIT_META[split].note}
					</motion.span>
				</AnimatePresence>
			</span>
		</p>
	);
}

type Row = { key: keyof EngineMetrics; label: string; lower?: boolean; unit?: string };
const GROUPS: { title: string; hint: string; rows: Row[] }[] = [
	{
		title: "Understanding questions",
		hint: "Ask Jev's plan: what you want, from whom, which mail",
		rows: [
			{ key: "intent", label: "Intent" },
			{ key: "intentBrier", label: "Confidence error (Brier)", lower: true },
			{ key: "unreadOnly", label: "Unread only" },
			{ key: "scope", label: "Inbox or Sent" },
			{ key: "sender", label: "Contact" },
		],
	},
	{
		title: "Triage",
		hint: "Deep triage on single emails",
		rows: [
			{ key: "category", label: "Category" },
			{ key: "hostileCategory", label: "Category, hostile emails" },
			{ key: "needsReply", label: "Needs a reply" },
			{ key: "urgencyMae", label: "Urgency error", lower: true },
		],
	},
	{
		title: "Finding mail",
		hint: "Ranking candidates for a topic question",
		rows: [
			{ key: "rankTop1", label: "Best match first" },
			{ key: "rankTop3", label: "Match in top 3" },
			{ key: "rankNone", label: "Says nothing matches" },
		],
	},
	{
		title: "Cost",
		hint: "Per decision call on this machine",
		rows: [
			{ key: "p50ms", label: "Median latency", lower: true, unit: "ms" },
			{ key: "p95ms", label: "p95 latency", lower: true, unit: "ms" },
			{ key: "degraded", label: "Fell back to keywords", lower: true },
		],
	},
];

const isRate = (v: unknown): v is Rate => typeof v === "object" && v !== null && "total" in v;
const ratio = (r: Rate) => (r.total ? r.hits / r.total : null);

function display(value: Rate | number, unit?: string): string {
	if (isRate(value)) {
		const r = ratio(value);
		return r === null ? "–" : `${Math.round(r * 100)}%`;
	}
	return unit ? `${value}${unit}` : String(value);
}

/** Comparable number per metric; null when the split has no cases for it. */
function numeric(value: Rate | number): number | null {
	return isRate(value) ? ratio(value) : value;
}

function MetricRow({ row, metrics, engines }: { row: Row; metrics: Partial<Record<EvalEngine, EngineMetrics>>; engines: EvalEngine[] }) {
	const values = engines.map((e) => {
		const m = metrics[e];
		return m ? numeric(m[row.key]) : null;
	});
	const present = values.filter((v): v is number => v !== null);
	const best = present.length > 1 ? (row.lower ? Math.min(...present) : Math.max(...present)) : null;
	const tie = best !== null && present.every((v) => v === best);
	return (
		<tr className="border-t border-border/70 dark:border-glass-border">
			<th scope="row" className="py-2 pr-3 text-left text-[13px] font-normal text-ink-2">
				{row.label}
			</th>
			{engines.map((e, i) => {
				const m = metrics[e];
				const v = values[i];
				const winner = !tie && v !== null && v === best;
				const isRateRow = m ? isRate(m[row.key]) : false;
				return (
					<td key={e} className="py-2 pl-3 text-right">
						<span className={cn("tabular font-mono text-[13px]", winner ? "text-foreground" : "text-ink-2")}>
							{m ? display(m[row.key], row.unit) : "–"}
						</span>
						{isRateRow && v !== null && (
							<span className="mt-1 ml-auto block h-1 w-16 overflow-hidden rounded-full bg-border" aria-hidden>
								<span className={cn("block h-full rounded-full", winner ? "bg-signal" : "bg-ink-3")} style={{ width: `${v * 100}%` }} />
							</span>
						)}
					</td>
				);
			})}
		</tr>
	);
}

function Scorecard({
	group,
	metrics,
	engines,
	i,
}: {
	group: (typeof GROUPS)[number];
	metrics: Partial<Record<EvalEngine, EngineMetrics>>;
	engines: EvalEngine[];
	i: number;
}) {
	return (
		<Bento i={i} className="col-span-12 md:col-span-6 2xl:col-span-3">
			<BentoTitle>{group.title}</BentoTitle>
			<p className="mt-1 text-[13px] text-ink-2">{group.hint}</p>
			<table className="mt-4 w-full">
				<thead>
					<tr>
						<th scope="col" className="sr-only">
							Metric
						</th>
						{engines.map((e) => (
							<th key={e} scope="col" className="pb-1 pl-3 text-right text-micro font-normal text-ink-2 uppercase">
								{ENGINE_LABEL[e]}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{group.rows.map((row) => (
						<MetricRow key={row.key} row={row} metrics={metrics} engines={engines} />
					))}
				</tbody>
			</table>
		</Bento>
	);
}

function Headline({ metrics, engines }: { metrics: Partial<Record<EvalEngine, EngineMetrics>>; engines: EvalEngine[] }) {
	const kage = metrics.kage;
	const base = metrics.heuristic;
	if (!kage || !base) return null;
	const stats: { label: string; key: keyof EngineMetrics }[] = [
		{ label: "Ask intent", key: "intent" },
		{ label: "Triage category", key: "category" },
		{ label: "Needs a reply", key: "needsReply" },
		{ label: "Best match first", key: "rankTop1" },
	];
	return (
		<Bento i={1} className="col-span-12">
			<div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
				{stats.map(({ label, key }) => {
					const k = numeric(kage[key]);
					const b = numeric(base[key]);
					const delta = k !== null && b !== null ? Math.round((k - b) * 100) : null;
					return (
						<div key={key} className="min-w-0">
							<p className="text-micro text-ink-2 uppercase">{label}</p>
							<p className="mt-1 font-display text-kpi-sm leading-none">{display(kage[key])}</p>
							{delta !== null && (
								<p className={cn("mt-1.5 tabular text-[12px]", delta > 0 ? "text-ok" : delta < 0 ? "text-critical" : "text-ink-2")}>
									{delta > 0 ? "+" : ""}
									{delta} pts vs keywords
								</p>
							)}
						</div>
					);
				})}
			</div>
			{engines.includes("jev") && <p className="mt-4 text-[12px] text-ink-2">Jev is scored too: compare it in the cards below.</p>}
		</Bento>
	);
}

type CaseFilter = "misses" | "disagree" | "all";
const FILTERS: { id: CaseFilter; label: string }[] = [
	{ id: "misses", label: "Kage misses" },
	{ id: "disagree", label: "Kage vs keywords differ" },
	{ id: "all", label: "All cases" },
];

function Verdict({ answer }: { answer: EvalCase["answers"][EvalEngine] }) {
	if (!answer) return <span className="text-ink-3">–</span>;
	return (
		<span className="flex items-start gap-1.5">
			{answer.ok ? (
				<Check className="mt-0.5 size-3.5 shrink-0 text-ok" aria-label="Correct" />
			) : (
				<X className="mt-0.5 size-3.5 shrink-0 text-critical" aria-label="Wrong" />
			)}
			<span className={cn("min-w-0 [overflow-wrap:anywhere]", !answer.ok && "text-foreground")}>
				{answer.value}
				{answer.confidence !== undefined && (
					<span className="ml-1.5 tabular font-mono text-[11px] text-ink-2">{Math.round(answer.confidence * 100)}%</span>
				)}
			</span>
		</span>
	);
}

const PAGE_SIZE = 10;

/**
 * Page numbers to show (0-based), null marking a gap. Past seven pages it
 * always returns seven slots (first, last, the current page and its
 * neighbours), so the pager keeps its width while you page through.
 */
function pageWindow(count: number, page: number): (number | null)[] {
	const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
	if (count <= 7) return range(0, count - 1);
	if (page <= 3) return [...range(0, 4), null, count - 1];
	if (page >= count - 4) return [0, null, ...range(count - 5, count - 1)];
	return [0, null, page - 1, page, page + 1, null, count - 1];
}

function Cases({ cases, engines }: { cases: EvalCase[]; engines: EvalEngine[] }) {
	const [filter, setFilter] = React.useState<CaseFilter>("misses");
	const shown = cases.filter((c) => {
		if (filter === "misses") return c.answers.kage && !c.answers.kage.ok;
		if (filter === "disagree") return c.answers.kage?.ok !== c.answers.heuristic?.ok;
		return true;
	});
	// The page belongs to one split + filter; switching either starts again at
	// page one. A rerun keeps the page, clamped if the list got shorter.
	const listKey = `${cases[0]?.split}:${filter}`;
	const [paging, setPaging] = React.useState({ key: listKey, page: 0 });
	const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
	const page = paging.key === listKey ? Math.min(paging.page, pageCount - 1) : 0;
	const start = page * PAGE_SIZE;
	const rows = shown.slice(start, start + PAGE_SIZE);
	const headRef = React.useRef<HTMLDivElement>(null);
	const goTo = (next: number) => {
		setPaging({ key: listKey, page: Math.max(0, Math.min(next, pageCount - 1)) });
		// Paging from the bottom of a long page: bring the new page's first row back into view.
		const head = headRef.current;
		if (head && head.getBoundingClientRect().top < 0) {
			const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
			head.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
		}
	};
	return (
		<Bento i={6} className="col-span-12">
			<div ref={headRef} className="flex scroll-mt-4 flex-wrap items-baseline justify-between gap-3">
				<div>
					<BentoTitle>Cases</BentoTitle>
					<p className="mt-1 text-[13px] text-ink-2">
						{shown.length} of {cases.length} in this split · fixtures live in <code className="font-mono">test/fixtures/kage/</code>
					</p>
				</div>
				<ToggleGroup
					aria-label="Filter cases"
					value={[filter]}
					onValueChange={(next) => next[0] && setFilter(next[0] as CaseFilter)}
					variant="pill"
					size="pill"
					spacing={0}
					className="max-w-full overflow-x-auto rounded-pill bg-sheet p-1 ring-1 ring-border dark:bg-background/40 dark:ring-glass-border"
				>
					{FILTERS.map((f) => (
						<ToggleGroupItem key={f.id} value={f.id} className="h-8 min-w-0 rounded-pill px-3 text-[12px]">
							{f.label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</div>
			{shown.length === 0 ? (
				<p className="mt-6 text-[13px] text-ink-2">{filter === "misses" ? "Kage got every case in this split right." : "Nothing here."}</p>
			) : (
				<div className="mt-4 overflow-x-auto">
					<table className="w-full min-w-[760px] text-[13px]">
						<thead>
							<tr className="text-left text-micro text-ink-2 uppercase">
								<th scope="col" className="pb-2 font-normal">
									Kind
								</th>
								<th scope="col" className="pb-2 pl-3 font-normal">
									Input
								</th>
								<th scope="col" className="pb-2 pl-3 font-normal">
									Expected
								</th>
								{engines.map((e) => (
									<th key={e} scope="col" className="pb-2 pl-3 font-normal">
										{ENGINE_LABEL[e]}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{rows.map((c) => (
								<tr key={c.id} className="border-t border-border/70 align-top dark:border-glass-border">
									<td className="py-2.5 font-mono text-[11px] text-ink-2 uppercase">{c.kind}</td>
									<td className="max-w-[320px] py-2.5 pl-3 [overflow-wrap:anywhere]">
										{c.input}
										{c.hostile && (
											<span className="ml-2 inline-flex items-center gap-1 rounded-pill bg-critical/8 px-1.5 py-0.5 align-middle text-[10px] text-critical">
												<ShieldAlert className="size-3" aria-hidden />
												hostile
											</span>
										)}
									</td>
									<td className="max-w-[240px] py-2.5 pl-3 text-ink-2 [overflow-wrap:anywhere]">{c.expected}</td>
									{engines.map((e) => (
										<td key={e} className="max-w-[260px] py-2.5 pl-3 text-ink-2">
											<Verdict answer={c.answers[e]} />
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{pageCount > 1 && (
				<nav
					aria-label="Case pages"
					className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4 dark:border-glass-border"
				>
					<p className="font-mono text-[11px] text-ink-2 tabular" aria-live="polite">
						{rows.length > 1 ? `${start + 1}–${start + rows.length}` : start + 1} of {shown.length}
					</p>
					<div className="flex items-center gap-1.5">
						<Button variant="surface" size="circle-sm" aria-label="Previous page" disabled={page === 0} onClick={() => goTo(page - 1)}>
							<ChevronLeft className="size-4" />
						</Button>
						<ToggleGroup
							aria-label="Page"
							value={[String(page)]}
							onValueChange={(next) => next[0] && goTo(Number(next[0]))}
							variant="pill"
							size="pill"
							spacing={0}
							className="rounded-pill bg-sheet p-1 ring-1 ring-border dark:bg-background/40 dark:ring-glass-border"
						>
							{pageWindow(pageCount, page).map((n, i) =>
								n === null ? (
									<span key={`gap-${i}`} aria-hidden className="w-6 text-center text-[12px] text-ink-2">
										…
									</span>
								) : (
									<ToggleGroupItem key={n} value={String(n)} aria-label={`Page ${n + 1}`} className="h-7 min-w-7 rounded-pill px-2 text-[12px] tabular">
										{n + 1}
									</ToggleGroupItem>
								),
							)}
						</ToggleGroup>
						<Button
							variant="surface"
							size="circle-sm"
							aria-label="Next page"
							disabled={page === pageCount - 1}
							onClick={() => goTo(page + 1)}
						>
							<ChevronRight className="size-4" />
						</Button>
					</div>
				</nav>
			)}
		</Bento>
	);
}

function Empty({ onRun, running }: { onRun: () => void; running: boolean }) {
	return (
		<Bento className="col-span-12 flex flex-col items-center gap-4 py-14 text-center">
			<span className="grid size-14 place-items-center rounded-full bg-signal-soft text-signal-ink dark:text-signal">
				<Gauge className="size-6" />
			</span>
			<div>
				<p className="font-display text-[17px]">No Kage eval yet</p>
				<p className="mx-auto mt-1 max-w-[380px] text-[13px] text-ink-2">
					Run it here, or from a terminal with <code className="font-mono text-foreground">bun run eval:kage</code>.
				</p>
			</div>
			<Button variant="inverse" size="pill" onClick={onRun} disabled={running}>
				{running ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Play data-icon="inline-start" />}
				{running ? "Running…" : "Run eval"}
			</Button>
		</Bento>
	);
}

/**
 * What a finished run changed. The eval is deterministic, so an unchanged
 * page is the common case: say so outright, or the click looks ignored.
 */
function runSummary(prev: KageEvalReport | null, next: KageEvalReport): string {
	if (!prev) return `${next.cases.length} cases scored.`;
	const changes: string[] = [];
	for (const split of SPLIT_ORDER) {
		for (const engine of next.engines) {
			const before = prev.metrics[split]?.[engine];
			const after = next.metrics[split][engine];
			if (!before || !after) continue;
			for (const group of GROUPS) {
				for (const row of group.rows) {
					const a = before[row.key];
					const b = after[row.key];
					if (!isRate(a) || !isRate(b) || display(a) === display(b)) continue;
					changes.push(`${SPLIT_META[split].label} · ${ENGINE_LABEL[engine]} ${row.label.toLowerCase()} ${display(a)} → ${display(b)}`);
				}
			}
		}
	}
	if (changes.length === 0) return "No score changed since the last run.";
	return changes.length === 1 ? changes[0]! : `${changes[0]}, and ${changes.length - 1} more ${changes.length === 2 ? "change" : "changes"}.`;
}

/** Starts an eval on the dev server; the finished report replaces the page's copy. */
function useEvalRun(initial: KageEvalReport | null) {
	const router = useRouter();
	// A finished run shows immediately; router.refresh() then brings the server copy in line.
	const [fresh, setFresh] = React.useState<KageEvalReport | null>(null);
	const [running, setRunning] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const report = fresh ?? initial;

	/** `previous` is the report on screen now, so the toast can say what changed. */
	const run = React.useCallback(async (previous: KageEvalReport | null) => {
		setRunning(true);
		setError(null);
		const fail = (message: string) => {
			setError(message);
			toast.error("Eval failed", { description: message });
		};
		try {
			const res = await fetch("/api/dev/kage-eval", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
			if (res.status === 401) {
				window.location.replace("/login");
				return;
			}
			if (!res.ok) {
				fail((await readApiError(res)).message);
				return;
			}
			const body = (await res.json()) as { data: KageEvalReport };
			toast.success(`Eval finished in ${body.data.ms}ms`, { description: runSummary(previous, body.data) });
			setFresh(body.data);
			router.refresh();
		} catch (err) {
			fail(toApiError(err).message);
		} finally {
			setRunning(false);
		}
	}, [router]);

	return { report, run, running, error };
}

export function KageEvalBoard({ report: initial }: { report: KageEvalReport | null }) {
	const { report, run, running, error } = useEvalRun(initial);
	const [{ split, dir }, setView] = React.useState<{ split: EvalSplit; dir: number }>({ split: "blind", dir: 1 });
	const setSplit = (next: EvalSplit) => setView({ split: next, dir: SPLIT_ORDER.indexOf(next) > SPLIT_ORDER.indexOf(split) ? 1 : -1 });
	const now = useNow();
	const start = () => void run(report);
	const metrics = report?.metrics[split] ?? {};
	const engines = report?.engines ?? [];

	return (
		<LayoutScroll className="h-full overflow-y-auto">
			<div className="mx-auto max-w-[calc(1900px-84px)] px-5 pt-6 md:px-8">
				<header className="entrance flex flex-wrap items-center justify-between gap-4 pb-6">
					<div className="min-w-0">
						<h1 className="font-display text-[22px] leading-tight tracking-[-0.01em]">Kage eval</h1>
						<p className="truncate text-[13px] text-ink-2" aria-live="polite">
							{running
								? `Scoring ${report ? `${report.cases.length} cases` : "every case"} with ${report ? report.engines.map((e) => ENGINE_LABEL[e]).join(", ") : "keywords and Kage"}…`
								: report
									? `Dev · last run ${now === null ? "" : formatAgo(report.at, now)} · ${report.ms}ms · Jev: ${report.jev.note}`
									: "Dev · Kage vs keyword rules on labeled asks, emails and searches"}
						</p>
					</div>
					<Button variant="inverse" size="pill" onClick={start} disabled={running}>
						{running ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Play data-icon="inline-start" />}
						{running ? "Running…" : "Run eval"}
					</Button>
				</header>
			</div>

			<div className="min-h-[70%] rounded-t-frame bg-sheet dark:border-t dark:border-glass-border">
				{/* The old scores stay readable while a run is out, but dim so they read as stale. */}
				<div
					aria-busy={running}
					className={cn(
						"mx-auto grid max-w-[calc(1900px-84px)] grid-cols-12 gap-4 px-5 py-6 transition-opacity duration-300 md:px-8 md:py-8",
						running && "opacity-50",
					)}
				>
					{error && (
						<Bento className="col-span-12" role="alert">
							<p className="text-[13px] text-critical">{error}</p>
						</Bento>
					)}
					{!report ? (
						<Empty onRun={start} running={running} />
					) : (
						<>
							<div className="col-span-12 flex flex-wrap items-center gap-3">
								<ToggleGroup
									aria-label="Fixture split"
									value={[split]}
									// Pressing the active tab would empty the group; keep a split selected.
									onValueChange={(next) => next[0] && setSplit(next[0] as EvalSplit)}
									variant="pill"
									size="pill"
									spacing={0}
									className="rounded-pill bg-sheet p-1 ring-1 ring-border dark:bg-background/40 dark:ring-glass-border"
								>
									{SPLIT_ORDER.map((s) => (
										<ToggleGroupItem key={s} value={s} className="h-8 min-w-0 rounded-pill px-3.5">
											{SPLIT_META[s].label}
										</ToggleGroupItem>
									))}
								</ToggleGroup>
								<SplitNote split={split} dir={dir} />
							</div>
							<Headline metrics={metrics} engines={engines} />
							{GROUPS.map((group, i) => (
								<Scorecard key={group.title} group={group} metrics={metrics} engines={engines} i={i + 2} />
							))}
							<Cases cases={report.cases.filter((c) => c.split === split)} engines={engines} />
						</>
					)}
				</div>
			</div>
		</LayoutScroll>
	);
}
