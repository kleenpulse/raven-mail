"use client";

import { FlaskConical, Play } from "lucide-react";
import { Bento, BentoTitle } from "@/components/overview/bento";
import { formatAgo } from "@/components/overview/orbit/format";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { useTestRun } from "@/hooks/use-test-run";
import type { TestHistory, TestReport } from "@/lib/dev/test-report";
import type { RunState } from "@/lib/dev/test-run-state";
import { cn } from "@/lib/utils";
import { DotStrip } from "./dot-strip";
import { FilesTable } from "./files-table";
import { CoverageTable, Failures, Health, Kpis, Slowest } from "./panels";
import { TestOrbit } from "./test-orbit";

function LiveRun({ state }: { state: RunState }) {
	const c = state.counts;
	return (
		<Bento className="col-span-12" aria-live="polite" aria-busy={state.status === "running"}>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<BentoTitle>{state.status === "error" ? "Run failed" : "Running the suite…"}</BentoTitle>
				<p className="tabular text-[13px] text-ink-2">
					<span className="text-ok">{c.pass} pass</span> · <span className={c.fail ? "text-critical" : undefined}>{c.fail} fail</span> ·{" "}
					{c.skip + c.todo} skipped · {state.files} files
				</p>
			</div>
			{state.currentFile && <p className="mt-1 truncate font-mono text-[12px] text-ink-2">{state.currentFile}</p>}
			{state.error && (
				<pre className="mt-3 max-h-48 overflow-auto rounded-[12px] bg-critical/6 p-3 font-mono text-[12px] whitespace-pre-wrap ring-1 ring-critical/20">
					{state.error}
				</pre>
			)}
			<DotStrip dots={state.dots} running={state.status === "running"} />
		</Bento>
	);
}

function Empty({ onRun, running }: { onRun: () => void; running: boolean }) {
	return (
		<Bento className="col-span-12 flex flex-col items-center gap-4 py-14 text-center">
			<span className="grid size-14 place-items-center rounded-full bg-signal-soft text-signal-ink dark:text-signal">
				<FlaskConical className="size-6" />
			</span>
			<div>
				<p className="font-display text-[17px]">No test report yet</p>
				<p className="mx-auto mt-1 max-w-[380px] text-[13px] text-ink-2">
					Run the suite here, or from a terminal with <code className="font-mono text-foreground">bun run test:report</code>.
				</p>
			</div>
			<Button variant="inverse" size="pill" onClick={onRun} disabled={running}>
				<Play data-icon="inline-start" />
				Run tests
			</Button>
		</Bento>
	);
}

export function TestsBoard({ report: initial, history: initialHistory }: { report: TestReport | null; history: TestHistory | null }) {
	const { state, run, running } = useTestRun();
	const now = useNow();
	// A finished run shows immediately; router.refresh() then brings the server copy in line.
	const report = state.report ?? initial;
	const history = state.history ?? initialHistory;
	const start = () => void run();

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto max-w-[calc(1900px-84px)] px-5 pt-6 md:px-8">
				<header className="entrance flex flex-wrap items-center justify-between gap-4 pb-6">
					<div className="min-w-0">
						<h1 className="font-display text-[22px] leading-tight tracking-[-0.01em]">Tests</h1>
						<p className="truncate text-[13px] text-ink-2">
							{report
								? `Dev · last run ${now === null ? "" : formatAgo(report.finishedAt, now)} · bun ${report.bun}${report.commit ? ` · ${report.commit}` : ""}`
								: "Dev · unit, route and DOM suites"}
						</p>
					</div>
					<div className="flex items-center gap-4">
						<Button variant="inverse" size="pill" onClick={start} disabled={running}>
							<Play data-icon="inline-start" className={cn(running && "animate-pulse")} />
							{running ? "Running…" : "Run tests"}
						</Button>
					</div>
				</header>
			</div>

			<div className="min-h-[70%] rounded-t-frame bg-sheet dark:border-t dark:border-glass-border">
				<div className="mx-auto grid max-w-[calc(1900px-84px)] grid-cols-12 gap-4 px-5 py-6 md:px-8 md:py-8">
					{(state.status === "running" || state.status === "error") && <LiveRun state={state} />}
					{!report ? (
						state.status !== "running" && <Empty onRun={start} running={running} />
					) : (
						<>
							<Kpis report={report} history={history} />
							<Failures report={report} />
							<Bento i={2} className="col-span-12 lg:col-span-8">
								<BentoTitle>Suite orbit</BentoTitle>
								<p className="mt-1 text-[13px] text-ink-2">Test files around the suite, grouped by area · failing files always shown</p>
								<TestOrbit report={report} history={history} />
							</Bento>
							<Health report={report} />
							<Bento i={4} className="col-span-12 lg:col-span-7">
								<BentoTitle>Files</BentoTitle>
								<div className="mt-4">
									<FilesTable files={report.files} />
								</div>
							</Bento>
							<Slowest report={report} />
							{report.coverage && <CoverageTable coverage={report.coverage} />}
						</>
					)}
				</div>
			</div>
		</div>
	);
}
