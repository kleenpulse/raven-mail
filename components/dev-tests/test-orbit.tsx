"use client";

import * as React from "react";
import { CircleX, Clock3, ListChecks, Timer } from "lucide-react";
import { StatusPill } from "@/components/integrations/status-pill";
import { Orbit } from "@/components/overview/orbit";
import { formatAgo, formatAgoLong, formatStamp } from "@/components/overview/orbit/format";
import { MAIL_VOCAB, type OrbitFocus, type OrbitVocab } from "@/components/overview/orbit/vocab";
import { SLOT_LABEL, toOrbitInput } from "@/lib/dev/test-orbit";
import { AREA_LABEL, LAYER_LABEL, type TestCase, type TestFile, type TestHistory, type TestReport } from "@/lib/dev/test-report";
import { cn } from "@/lib/utils";
import { FileDetail } from "./file-detail";
import { formatMs, STATUS_LABEL, STATUS_TONE } from "./shared";

/** Failures first, then slowest: the five most worth a look. */
function spotlight(f: TestFile): TestCase[] {
	return [...f.tests].sort((a, b) => Number(b.status === "fail") - Number(a.status === "fail") || b.ms - a.ms).slice(0, 5);
}

function TestFocusRow({ test }: { test: TestCase }) {
	return (
		<div className="flex h-full items-center gap-3 rounded-[14px] bg-sheet px-3.5 ring-1 ring-border dark:bg-card-nested dark:ring-glass-border">
			<StatusPill tone={STATUS_TONE[test.status]} className="shrink-0">
				{STATUS_LABEL[test.status]}
			</StatusPill>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-[13.5px] leading-tight">{test.name}</span>
				<span className="mt-0.5 block truncate text-[11.5px] text-ink-2">
					{test.error ? test.error.message.split("\n")[0] : test.path.join(" › ") || "top level"}
				</span>
			</span>
			<span className="tabular shrink-0 font-mono text-[11px] text-ink-2">{formatMs(test.ms)}</span>
		</div>
	);
}

function MiniBars({ values, labels, format, title }: { values: number[]; labels: string[]; format: (n: number) => string; title: string }) {
	const max = Math.max(1, ...values);
	return (
		<div className="mt-4">
			<p className="readout">{title}</p>
			<ul className="mt-2 grid items-end gap-2" style={{ height: 64, gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}>
				{values.map((v, i) => (
					<li key={i} className="flex h-full min-w-0 flex-col items-center justify-end gap-1">
						<span className="tabular truncate font-mono text-[10px] text-ink-2">{format(v)}</span>
						<span
							className={cn("w-full rounded-[4px]", i === values.length - 1 ? "bg-signal" : "bg-foreground/15 dark:bg-foreground/20")}
							style={{ height: `${Math.max(3, (v / max) * 36)}px` }}
						/>
						<span className="font-mono text-[10px] text-ink-2">{labels[i]}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

const runLabel = (i: number, n: number) => (i === n - 1 ? "Now" : `−${n - 1 - i}`);

function testFocus(byFile: Map<string, TestFile>, runs: number): OrbitFocus {
	return {
		cards: (s, now) => {
			const f = byFile.get(s.address);
			const total = f?.counts.total ?? s.count;
			const fail = f?.counts.fail ?? s.unread;
			const ms = formatMs(f?.ms ?? 0);
			const ago = now === null ? "—" : formatAgo(s.lastAt, now);
			return [
				{ id: "threads", icon: ListChecks, value: String(total), label: "Tests", spoken: `${total} tests` },
				{ id: "unread", icon: CircleX, value: String(fail), label: "Failing", spoken: `${fail} failing` },
				{ id: "reply", icon: Timer, value: ms, label: "Run time", spoken: `runs in ${ms}` },
				{ id: "last", icon: Clock3, value: ago, label: "Last run", spoken: `last run ${ago}` },
			];
		},
		rows: (s) => {
			const f = byFile.get(s.address);
			return f ? spotlight(f).map((t) => ({ key: t.id, node: <TestFocusRow test={t} /> })) : [];
		},
		rowsTitle: (s) => ((byFile.get(s.address)?.counts.fail ?? 0) > 0 ? "Failures first" : "Slowest tests"),
		rowsNote: (s) => {
			const fail = byFile.get(s.address)?.counts.fail ?? 0;
			return fail > 0 ? `${fail} failing` : null;
		},
		emptyRows: "No tests in this file.",
		panel: (s, id, now) => {
			const f = byFile.get(s.address);
			if (!f) return null;
			if (id === "unread") {
				const failing = f.tests.filter((t) => t.status === "fail");
				return (
					<>
						<p className="readout">Failures</p>
						<p className={cn("tabular mt-2 font-display text-[34px] leading-none", failing.length && "text-critical")}>{failing.length}</p>
						{failing.length === 0 ? (
							<p className="mt-2 text-[13px] text-ink-2">Every test in this file passes.</p>
						) : (
							<ul className="mt-3 flex flex-col gap-2">
								{failing.slice(0, 3).map((t) => (
									<li key={t.id} className="min-w-0 text-[12.5px]">
										<span className="block truncate">{t.name}</span>
										<span className="block truncate font-mono text-[11px] text-ink-2">{t.error?.message.split("\n")[0]}</span>
									</li>
								))}
							</ul>
						)}
					</>
				);
			}
			if (id === "reply") {
				const slowest = [...f.tests].sort((a, b) => b.ms - a.ms)[0];
				const perRun = s.daily.slice(-6);
				return (
					<>
						<p className="readout">Run time</p>
						<p className="tabular mt-2 font-display text-[34px] leading-none">{formatMs(f.ms)}</p>
						{slowest && (
							<p className="mt-2 truncate text-[13px] text-ink-2">
								Slowest: {slowest.name} · {formatMs(slowest.ms)}
							</p>
						)}
						{perRun.length > 1 && (
							<MiniBars title="Per run" values={perRun} labels={perRun.map((_, i) => runLabel(i, perRun.length))} format={formatMs} />
						)}
					</>
				);
			}
			return (
				<>
					<p className="readout">Last run</p>
					<p className="mt-2 font-display text-[28px] leading-none">{now === null ? "—" : formatAgo(s.lastAt, now)}</p>
					<p className="mt-1.5 text-[13px] text-ink-2">{formatStamp(s.lastAt)}</p>
					<MiniBars title="Tests per run" values={s.weekly} labels={s.weekly.map((_, i) => runLabel(i, 4))} format={String} />
				</>
			);
		},
		panelHeight: { unread: 230, reply: 230, last: 244 },
		chip: (s) => {
			const f = byFile.get(s.address);
			return f ? `${AREA_LABEL[f.area]} · ${LAYER_LABEL[f.layer]}` : SLOT_LABEL[s.category];
		},
		ringCaption: `${Math.max(1, runs)} ${runs === 1 ? "run" : "runs"} · 1 tick = 1 run`,
	};
}

function testVocab(report: TestReport, runs: number): OrbitVocab {
	const byFile = new Map(report.files.map((f) => [f.file, f]));
	return {
		...MAIL_VOCAB,
		sun: "Suite",
		unit: ["test", "tests"],
		node: ["file", "files"],
		group: ["area", "areas"],
		mass: "the suite",
		categoryLabel: SLOT_LABEL,
		flag: { label: "failing", chip: "failing", clear: "All passing" },
		period: null,
		window: { all: "latest run", week: (i) => `run ${i + 1} of the last 4` },
		legend: {
			person: "Route + DOM",
			machine: "Unit",
			ring: "Ring around the suite: run time, last 30 runs",
			hint: "Select a file to see its tests",
		},
		srHint: "Arrow keys move between test files. Enter opens a file. Escape returns.",
		sceneLabel: "Test files in orbit around the suite",
		empty: { title: "No tests in orbit", body: "Run the suite and every test file will circle here, grouped by area." },
		recency: (s, now) => `Ran ${formatAgo(s.lastAt, now)}`,
		recencyLong: (s, now) => `ran ${formatAgoLong(s.lastAt, now)}`,
		describe: (s) => {
			const f = byFile.get(s.address);
			return f ? `${f.counts.total} tests, ${f.counts.fail} failing` : "";
		},
		focus: testFocus(byFile, runs),
		expand: {
			label: (s) => `View all ${byFile.get(s.address)?.counts.total ?? s.count} tests`,
			render: (s) => {
				const f = byFile.get(s.address);
				return f ? <FileDetail file={f} /> : null;
			},
		},
	};
}

export function TestOrbit({ report, history }: { report: TestReport; history: TestHistory | null }) {
	const input = React.useMemo(() => toOrbitInput(report, history), [report, history]);
	const runs = history?.runs.length ?? 1;
	const vocab = React.useMemo(() => testVocab(report, runs), [report, runs]);
	return <Orbit senders={input.senders} categories={input.categories} vocab={vocab} />;
}
