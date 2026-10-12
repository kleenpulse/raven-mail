"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { LAYERS, LAYER_LABEL, type TestFile, type TestLayer } from "@/lib/dev/test-report";
import { fileTitle } from "@/lib/dev/test-orbit";
import { cn } from "@/lib/utils";
import { FileDetail } from "./file-detail";
import { formatMs } from "./shared";

type StatusFilter = "all" | "failing";

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			aria-pressed={on}
			onClick={onClick}
			className={cn(
				"h-7 rounded-pill px-3 text-[12px] ring-1 transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none",
				on ? "bg-inverse text-inverse-foreground ring-inverse dark:bg-signal dark:text-primary-foreground dark:ring-signal" : "text-ink-2 ring-border hover:text-foreground dark:ring-glass-border",
			)}
		>
			{children}
		</button>
	);
}

/** Every file (the orbit shows at most 24), filterable. */
export function FilesTable({ files }: { files: TestFile[] }) {
	const [status, setStatus] = React.useState<StatusFilter>("all");
	const [layers, setLayers] = React.useState<Set<TestLayer>>(() => new Set(LAYERS));
	const [q, setQ] = React.useState("");
	const [open, setOpen] = React.useState<TestFile | null>(null);

	const shown = React.useMemo(() => {
		const needle = q.trim().toLowerCase();
		return files
			.filter((f) => layers.has(f.layer))
			.filter((f) => status === "all" || f.counts.fail > 0)
			.filter((f) => !needle || f.file.toLowerCase().includes(needle) || f.tests.some((t) => t.name.toLowerCase().includes(needle)))
			.sort((a, b) => b.counts.fail - a.counts.fail || a.file.localeCompare(b.file));
	}, [files, layers, status, q]);

	const toggleLayer = (l: TestLayer) =>
		setLayers((prev) => {
			const next = new Set(prev);
			if (next.has(l) && next.size > 1) next.delete(l);
			else next.add(l);
			return next;
		});

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<Chip on={status === "all"} onClick={() => setStatus("all")}>
					All
				</Chip>
				<Chip on={status === "failing"} onClick={() => setStatus("failing")}>
					Failing
				</Chip>
				<span aria-hidden className="mx-1 h-4 w-px bg-border dark:bg-glass-border" />
				{LAYERS.map((l) => (
					<Chip key={l} on={layers.has(l)} onClick={() => toggleLayer(l)}>
						{LAYER_LABEL[l]}
					</Chip>
				))}
				<label className="ml-auto flex h-8 min-w-[180px] flex-1 items-center gap-2 rounded-pill bg-sheet px-3 ring-1 ring-border sm:max-w-[260px] sm:flex-none dark:bg-card-nested dark:ring-glass-border">
					<Search className="size-3.5 text-ink-2" />
					<input
						value={q}
						onChange={(e) => setQ(e.target.value)}
						placeholder="Filter files or tests"
						aria-label="Filter files or tests"
						className="w-full bg-transparent text-[13px] outline-none placeholder:text-ink-3"
					/>
				</label>
			</div>
			<p className="text-[12px] text-ink-2" aria-live="polite">
				{shown.length} of {files.length} files
			</p>
			<ul className="scrollbar-thin flex max-h-[420px] flex-col overflow-y-auto">
				{shown.map((f) => (
					<li key={f.file}>
						<button
							type="button"
							onClick={() => setOpen(f)}
							className="grid w-full grid-cols-[0.5rem_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-[12px] px-2.5 py-2 text-left hover:bg-sheet focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none dark:hover:bg-card-nested"
						>
							<span className={cn("size-2 rounded-full", f.counts.fail ? "bg-critical" : "bg-ok")} />
							<span className="min-w-0">
								<span className="block truncate text-[13px]">{fileTitle(f.file)}</span>
								<span className="block truncate font-mono text-[11px] text-ink-2">{f.file}</span>
							</span>
							<span className="tabular text-right text-[12px]">
								{f.counts.fail > 0 && <span className="text-critical">{f.counts.fail} ✕ · </span>}
								{f.counts.total}
							</span>
							<span className="tabular w-14 text-right text-[12px] text-ink-2">{formatMs(f.ms)}</span>
						</button>
					</li>
				))}
			</ul>
			<Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
				<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
					<DialogTitle>{open ? fileTitle(open.file) : ""}</DialogTitle>
					{open && <FileDetail file={open} />}
				</DialogContent>
			</Dialog>
		</div>
	);
}
