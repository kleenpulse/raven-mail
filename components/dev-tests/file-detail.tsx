"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { StatusPill } from "@/components/integrations/status-pill";
import { AREA_LABEL, LAYER_LABEL, type TestCase, type TestFile } from "@/lib/dev/test-report";
import { cn } from "@/lib/utils";
import { formatMs, STATUS_LABEL, STATUS_TONE } from "./shared";

/** Every test in one file; failures first and open by default. */
export function FileDetail({ file }: { file: TestFile }) {
	const tests = React.useMemo(
		() => [...file.tests].sort((a, b) => Number(b.status === "fail") - Number(a.status === "fail")),
		[file.tests],
	);
	const c = file.counts;
	return (
		<div className="flex flex-col gap-4">
			<div>
				<p className="font-mono text-[12px] text-ink-2">{file.file}</p>
				<p className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
					<StatusPill tone={c.fail ? "attention" : "ok"}>{c.fail ? `${c.fail} failing` : "All passing"}</StatusPill>
					<span className="rounded-pill px-2 py-0.5 ring-1 ring-border dark:ring-glass-border">{LAYER_LABEL[file.layer]}</span>
					<span className="rounded-pill px-2 py-0.5 ring-1 ring-border dark:ring-glass-border">{AREA_LABEL[file.area]}</span>
					<span className="tabular">
						{c.total} tests · {formatMs(file.ms)}
					</span>
				</p>
			</div>
			<ul className="scrollbar-thin flex max-h-[560px] flex-col divide-y divide-border overflow-y-auto rounded-card bg-sheet ring-1 ring-border dark:divide-glass-border dark:bg-card-nested dark:ring-glass-border">
				{tests.map((t) => (
					<TestRow key={t.id} test={t} />
				))}
			</ul>
		</div>
	);
}

export function TestRow({ test, showFile, defaultOpen = test.status === "fail" }: { test: TestCase; showFile?: string; defaultOpen?: boolean }) {
	const [open, setOpen] = React.useState(defaultOpen);
	const title = [...test.path, test.name].join(" › ");
	const body = (
		<>
			<StatusPill tone={STATUS_TONE[test.status]} className="shrink-0">
				{STATUS_LABEL[test.status]}
			</StatusPill>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-[13px]">{title}</span>
				{showFile && <span className="block truncate font-mono text-[11px] text-ink-2">{showFile}</span>}
			</span>
			<span className="tabular shrink-0 text-[12px] text-ink-2">{formatMs(test.ms)}</span>
		</>
	);
	if (!test.error) return <li className="flex items-center gap-3 px-3.5 py-2.5">{body}</li>;
	return (
		<li>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
				className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none dark:hover:bg-accent"
			>
				<ChevronRight className={cn("size-3.5 shrink-0 text-ink-2 transition-transform", open && "rotate-90")} />
				{body}
			</button>
			{open && (
				<pre className="scrollbar-thin mx-3.5 mb-3 max-h-72 overflow-auto rounded-[12px] bg-critical/6 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-foreground ring-1 ring-critical/20">
					{test.error.detail ?? test.error.message}
				</pre>
			)}
		</li>
	);
}
