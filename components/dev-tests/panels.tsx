"use client";

import * as React from "react";
import { Bento, BentoTitle } from "@/components/overview/bento";
import { CountUp } from "@/components/viz/count-up";
import { Ring } from "@/components/viz/ring";
import { Sparkline } from "@/components/viz/sparkline";
import {
	addCounts,
	emptyCounts,
	LAYERS,
	LAYER_LABEL,
	passRate,
	pct,
	type Coverage,
	type TestHistory,
	type TestReport,
} from "@/lib/dev/test-report";
import { cn } from "@/lib/utils";
import { TestRow } from "./file-detail";
import { coverageTone, formatMs, formatPct } from "./shared";

const TONE_BAR = { ok: "bg-ok", warn: "bg-warn", critical: "bg-critical", none: "bg-ink-3" } as const;
const TONE_TEXT = { ok: "text-ok", warn: "text-warn", critical: "text-critical", none: "text-ink-2" } as const;

function Stat({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
	return (
		<div className={cn("min-w-0", className)}>
			<p className="text-micro text-ink-2 uppercase">{label}</p>
			<p className="mt-1 font-display text-kpi-sm leading-none">{children}</p>
		</div>
	);
}

export function Kpis({ report, history }: { report: TestReport; history: TestHistory | null }) {
	const c = report.counts;
	const lines = report.coverage ? pct(report.coverage.lines) : null;
	const runs = history?.runs ?? [];
	return (
		<Bento i={1} className="col-span-12">
			<div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-[repeat(6,minmax(0,1fr))_minmax(0,1.6fr)]">
				<Stat label="Tests">
					<CountUp value={c.total} />
				</Stat>
				<Stat label="Passing" className="text-ok">
					<CountUp value={c.pass} />
				</Stat>
				<Stat label="Failing" className={c.fail ? "text-critical" : undefined}>
					<CountUp value={c.fail} />
				</Stat>
				<Stat label="Skipped">
					<CountUp value={c.skip + c.todo} />
				</Stat>
				<Stat label="Duration">{formatMs(report.ms)}</Stat>
				<Stat label="Line coverage" className={TONE_TEXT[coverageTone(lines)]}>
					{formatPct(lines)}
				</Stat>
				<div className="col-span-2 min-w-0 sm:col-span-3 lg:col-span-1">
					<p className="text-micro text-ink-2 uppercase">Tests over {runs.length} runs</p>
					{runs.length > 1 ? (
						<Sparkline values={runs.map((r) => r.counts.total)} label={`Test count across the last ${runs.length} runs`} height={44} className="mt-1" />
					) : (
						<p className="mt-2 text-[12px] text-ink-2">History builds up as you run the suite.</p>
					)}
				</div>
			</div>
		</Bento>
	);
}

export function Health({ report }: { report: TestReport }) {
	const rate = passRate(report.counts);
	const byLayer = LAYERS.map((layer) => ({
		layer,
		counts: report.files.filter((f) => f.layer === layer).reduce((acc, f) => addCounts(acc, f.counts), emptyCounts()),
		files: report.files.filter((f) => f.layer === layer).length,
	}));
	const max = Math.max(1, ...byLayer.map((l) => l.counts.total));
	return (
		<Bento i={3} className="col-span-12 flex flex-col gap-6 lg:col-span-4">
			<BentoTitle>Health</BentoTitle>
			<div className="flex items-center gap-5">
				<Ring value={rate ?? 0} size={120} label={`Pass rate ${formatPct(rate)}`}>
					<span className="flex flex-col items-center">
						<span className="font-display text-[22px] leading-none">{formatPct(rate)}</span>
						<span className="mt-1 text-[11px] opacity-70">pass rate</span>
					</span>
				</Ring>
				<div className="text-[13px] text-ink-2">
					<p>
						<span className="tabular text-foreground">{report.files.length}</span> files
					</p>
					<p className="mt-1">
						exit code <span className={cn("tabular", report.exitCode ? "text-critical" : "text-ok")}>{report.exitCode}</span>
					</p>
					{report.coverage && (
						<p className="mt-1">
							functions <span className="tabular text-foreground">{formatPct(pct(report.coverage.funcs))}</span>
						</p>
					)}
				</div>
			</div>
			<div>
				<p className="text-micro text-ink-2 uppercase">By layer</p>
				<ul className="mt-3 flex flex-col gap-3">
					{byLayer.map(({ layer, counts, files }) => (
						<li key={layer}>
							<div className="flex items-baseline justify-between text-[13px]">
								<span>{LAYER_LABEL[layer]}</span>
								<span className="tabular text-ink-2">
									{counts.fail > 0 && <span className="text-critical">{counts.fail} failing · </span>}
									{counts.total} tests · {files} files
								</span>
							</div>
							<div className="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-foreground/8">
								<div className="flex h-full" style={{ width: `${(counts.total / max) * 100}%` }}>
									<span className="h-full bg-ok" style={{ flexGrow: counts.pass }} />
									<span className="h-full bg-critical" style={{ flexGrow: counts.fail }} />
									<span className="h-full bg-ink-3" style={{ flexGrow: counts.skip + counts.todo }} />
								</div>
							</div>
						</li>
					))}
				</ul>
			</div>
		</Bento>
	);
}

const FAILURES_SHOWN = 8;

export function Failures({ report }: { report: TestReport }) {
	const [all, setAll] = React.useState(false);
	const failing = report.files.flatMap((f) => f.tests.filter((t) => t.status === "fail").map((t) => ({ t, file: f.file })));
	if (!failing.length) return null;
	const shown = all ? failing : failing.slice(0, FAILURES_SHOWN);
	return (
		<Bento i={2} className="col-span-12 ring-1 ring-critical/30">
			<BentoTitle className="text-critical">
				{failing.length} failing {failing.length === 1 ? "test" : "tests"}
			</BentoTitle>
			<ul className="mt-4 flex flex-col divide-y divide-border rounded-card bg-sheet ring-1 ring-border dark:divide-glass-border dark:bg-card-nested dark:ring-glass-border">
				{shown.map(({ t, file }, i) => (
					<TestRow key={t.id} test={t} showFile={file} defaultOpen={i === 0} />
				))}
			</ul>
			{failing.length > FAILURES_SHOWN && (
				<button
					type="button"
					onClick={() => setAll((a) => !a)}
					className="mt-3 rounded-pill px-3.5 py-2 text-[13px] text-ink-2 ring-1 ring-border hover:text-foreground dark:ring-glass-border"
				>
					{all ? `Show first ${FAILURES_SHOWN}` : `Show all ${failing.length} failures`}
				</button>
			)}
		</Bento>
	);
}

export function Slowest({ report }: { report: TestReport }) {
	const top = report.files
		.flatMap((f) => f.tests.map((t) => ({ t, file: f.file })))
		.sort((a, b) => b.t.ms - a.t.ms)
		.slice(0, 10);
	const max = Math.max(1, ...top.map((x) => x.t.ms));
	return (
		<Bento i={5} className="col-span-12 lg:col-span-5">
			<BentoTitle>Slowest tests</BentoTitle>
			<ol className="mt-4 flex flex-col gap-3">
				{top.map(({ t, file }, i) => (
					<li key={t.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3">
						<span className="tabular font-mono text-[11px] text-ink-2">{i + 1}</span>
						<span className="min-w-0">
							<span className="block truncate text-[13px]">{t.name}</span>
							<span className="block truncate font-mono text-[11px] text-ink-2">{file}</span>
						</span>
						<span className="tabular text-[12px]">{formatMs(t.ms)}</span>
						<span />
						<span className="col-span-2 mt-1 h-1 overflow-hidden rounded-pill bg-foreground/8">
							<span className="block h-full rounded-pill bg-signal" style={{ width: `${(t.ms / max) * 100}%` }} />
						</span>
					</li>
				))}
			</ol>
		</Bento>
	);
}

export function CoverageTable({ coverage }: { coverage: Coverage }) {
	const [all, setAll] = React.useState(false);
	const rows = React.useMemo(
		() =>
			coverage.files
				.map((f) => ({ ...f, l: pct(f.lines), fn: pct(f.funcs) }))
				.sort((a, b) => (a.l ?? 101) - (b.l ?? 101) || a.file.localeCompare(b.file)),
		[coverage.files],
	);
	const shown = all ? rows : rows.slice(0, 15);
	return (
		<Bento i={6} className="col-span-12">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<BentoTitle>Coverage</BentoTitle>
				<p className="text-[12px] text-ink-2">
					lines <span className="tabular text-foreground">{formatPct(pct(coverage.lines))}</span> · functions{" "}
					<span className="tabular text-foreground">{formatPct(pct(coverage.funcs))}</span> · {coverage.files.length} files loaded by tests,
					least covered first
				</p>
			</div>
			<table className="mt-4 w-full text-[13px]">
				<thead className="text-micro text-ink-2 uppercase">
					<tr>
						<th className="pb-2 text-left font-normal">File</th>
						<th className="w-[30%] pb-2 text-left font-normal">Lines</th>
						<th className="w-20 pb-2 text-right font-normal">Funcs</th>
					</tr>
				</thead>
				<tbody>
					{shown.map((r) => {
						const tone = coverageTone(r.l);
						return (
							<tr key={r.file} className="border-t border-border dark:border-glass-border">
								<td className="max-w-0 truncate py-1.5 pr-3 font-mono text-[12px]">{r.file}</td>
								<td className="py-1.5 pr-3">
									<span className="flex items-center gap-2">
										<span className="h-1.5 flex-1 overflow-hidden rounded-pill bg-foreground/8">
											<span className={cn("block h-full rounded-pill", TONE_BAR[tone])} style={{ width: `${r.l ?? 0}%` }} />
										</span>
										<span className={cn("tabular w-12 text-right text-[12px]", TONE_TEXT[tone])}>{formatPct(r.l)}</span>
									</span>
								</td>
								<td className="tabular py-1.5 text-right text-[12px] text-ink-2">{formatPct(r.fn)}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			{rows.length > 15 && (
				<button
					type="button"
					onClick={() => setAll((a) => !a)}
					className="mt-3 rounded-pill px-3.5 py-2 text-[13px] text-ink-2 ring-1 ring-border hover:text-foreground dark:ring-glass-border"
				>
					{all ? "Show least covered 15" : `Show all ${rows.length} files`}
				</button>
			)}
		</Bento>
	);
}
