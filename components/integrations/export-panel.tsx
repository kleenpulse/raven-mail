"use client";

import * as React from "react";
import { CheckCircle2, HardDrive, HardDriveDownload, MemoryStick, Pause, Play, Trash2 } from "lucide-react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ActivityList } from "@/components/integrations/activity-list";
import { useFolders } from "@/hooks/use-mail";
import { formatBytes, formatEta, percent } from "@/lib/integrations/export/progress";
import type { ExportRange } from "@/lib/integrations/types";
import { canStreamToDisk, exportRun, useExportRun } from "@/lib/store/export-run";
import { cn } from "@/lib/utils";

const RANGES: { value: ExportRange; label: string }[] = [
	{ value: "all", label: "All time" },
	{ value: "365d", label: "12 months" },
	{ value: "30d", label: "30 days" },
];

const subscribeNoop = () => () => {};

function RunView() {
	const run = useStore(useExportRun);
	const p = run.progress;
	const pct = p ? percent(p) : null;
	const folderName = run.folder === "INBOX" ? "Inbox" : run.folder;

	if (run.phase === "planning") {
		return (
			<div className="space-y-3" aria-live="polite">
				<p className="text-[13px]">Counting messages in {folderName}…</p>
				<Progress value={null} aria-label="Planning export" />
				<Button variant="ghost" size="pill-sm" onClick={() => void exportRun.discard()}>
					Cancel
				</Button>
			</div>
		);
	}

	const stats = p
		? [
				`${p.done.toLocaleString("en-US")} of ${p.total.toLocaleString("en-US")} messages`,
				formatBytes(p.receivedBytes),
				p.rateBps && run.phase === "running" ? `${formatBytes(Math.round(p.rateBps))}/s` : null,
				run.phase === "running" ? formatEta(p.etaMs) : null,
			].filter(Boolean)
		: [];

	return (
		<div className="space-y-4">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="text-[13px] font-medium">
						{run.phase === "saving" ? "Finishing the file…" : run.phase === "paused" ? "Export paused" : `Exporting ${folderName}`}
					</p>
					<p className="mt-0.5 truncate font-mono text-[11px] text-ink-2">
						{run.fileName} · {run.sink === "disk" ? "writing to disk" : "held in memory"}
					</p>
				</div>
				<span className="shrink-0 font-display text-kpi-sm leading-none tabular">{pct ?? 0}%</span>
			</div>

			<Progress
				value={pct}
				aria-label="Export progress"
				indicatorClassName={cn(run.phase === "paused" && (run.error ? "bg-critical" : "bg-ink-3"))}
			>
				<span className="font-mono text-[11px] text-ink-2 tabular">{stats.join(" · ")}</span>
			</Progress>
			<p aria-live="polite" className="sr-only">
				{run.phase === "running" && pct !== null && pct % 10 === 0 ? `${pct}% exported` : ""}
			</p>

			{run.phase === "running" && (
				<Button variant="surface" size="pill-sm" onClick={() => exportRun.pause()}>
					<Pause />
					Pause
				</Button>
			)}

			{run.phase === "paused" && (
				<div role={run.error ? "alert" : undefined} className={cn("rounded-[18px] px-4 py-3 ring-1", run.error ? "bg-critical/8 ring-critical/25" : "bg-card-nested ring-border dark:ring-glass-border")}>
					<p className="text-[13px] font-medium">{run.error ? run.error.message : "Paused. Everything saved so far is intact."}</p>
					<p className="mt-1 text-[12px] leading-relaxed text-ink-2">
						{run.error?.hint ?? "Resume to continue from the next message, or keep the file as it is."}
					</p>
					<div className="mt-3 flex flex-wrap gap-2">
						{(!run.error || run.error.retryable) && (
							<Button size="pill-sm" onClick={() => exportRun.resume()}>
								<Play />
								{run.error ? "Retry" : "Resume"}
							</Button>
						)}
						{(p?.done ?? 0) > 0 && (
							<Button variant="surface" size="pill-sm" onClick={() => void exportRun.keepPartial()}>
								Keep {p!.done.toLocaleString("en-US")} saved
							</Button>
						)}
						<Button variant="ghost" size="pill-sm" onClick={() => void exportRun.discard()}>
							<Trash2 />
							Discard
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

function StartForm() {
	const folders = useFolders();
	const [folder, setFolder] = React.useState("INBOX");
	const [range, setRange] = React.useState<ExportRange>("all");
	const toDisk = React.useSyncExternalStore(subscribeNoop, canStreamToDisk, () => true);
	const selected = folders.data?.find((f) => f.path === folder);
	const items = (folders.data ?? []).map((f) => ({ value: f.path, label: f.name }));

	return (
		<div className="space-y-4">
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-2">
					<Label htmlFor="export-folder">Folder</Label>
					<Select items={items} value={folder} onValueChange={(v) => v && setFolder(v as string)}>
						<SelectTrigger id="export-folder" className="w-full rounded-xl bg-sheet px-3.5 data-[size=default]:h-11 dark:bg-card-nested">
							<SelectValue placeholder={folders.isPending ? "Loading folders…" : "Pick a folder"} />
						</SelectTrigger>
						<SelectContent>
							{(folders.data ?? []).map((f) => (
								<SelectItem key={f.path} value={f.path}>
									{f.name}
									<span className="ml-auto font-mono text-[11px] text-ink-3 tabular">{f.total.toLocaleString("en-US")}</span>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-2">
					<span id="export-range" className="block text-sm leading-none font-medium">
						Range
					</span>
					<ToggleGroup
						value={[range]}
						onValueChange={(next) => next[0] && setRange(next[0] as ExportRange)}
						variant="pill"
						size="pill"
						spacing={0}
						aria-labelledby="export-range"
						className="w-full rounded-pill bg-card p-1 dark:bg-background/40"
					>
						{RANGES.map((r) => (
							<ToggleGroupItem key={r.value} value={r.value} className="h-9 flex-1 rounded-pill px-2 text-[12px]">
								{r.label}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</div>
			</div>

			<p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-2">
				{toDisk ? <HardDrive className="mt-0.5 size-3.5 shrink-0" /> : <MemoryStick className="mt-0.5 size-3.5 shrink-0" />}
				{toDisk
					? "You'll pick where to save; messages stream straight to that file."
					: "This browser builds the file in memory — for very large folders, use Chrome or Edge, or a shorter range."}
				{selected && range === "all" && ` ${selected.total.toLocaleString("en-US")} messages in ${selected.name}.`}
			</p>

			<Button size="pill" onClick={() => void exportRun.start(folder, range)} disabled={!folders.data}>
				<HardDriveDownload />
				Export .mbox
			</Button>
		</div>
	);
}

export function ExportPanel({ dbReady }: { dbReady: boolean }) {
	const run = useStore(useExportRun);
	const active = ["planning", "running", "paused", "saving"].includes(run.phase);
	const finished = run.phase === "done" || run.phase === "stopped";

	return (
		<div className="space-y-6">
			<p className="text-[13px] leading-relaxed text-ink-2">
				Fetched in batches of whole messages, so a pause, a dropped connection or a closed laptop never leaves a broken
				file. Read-only: nothing on the server changes, and messages stay unread.
			</p>

			{finished && (
				<div role="status" className={cn("flex items-start gap-3 rounded-[18px] px-4 py-3 ring-1", run.phase === "done" ? "bg-ok/8 ring-ok/25" : "bg-card-nested ring-border dark:ring-glass-border")}>
					{run.phase === "done" && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />}
					<div className="min-w-0 flex-1">
						<p className="text-[13px] font-medium">{run.phase === "done" ? `Saved ${run.fileName}` : run.outcome}</p>
						{run.phase === "done" && <p className="mt-0.5 text-[12px] text-ink-2">{run.outcome}</p>}
						{run.error && run.phase === "stopped" && run.error.hint && <p className="mt-0.5 text-[12px] text-ink-2">{run.error.hint}</p>}
					</div>
					<Button variant="ghost" size="pill-sm" onClick={() => exportRun.dismiss()}>
						Export another
					</Button>
				</div>
			)}

			{active ? <RunView /> : !finished && <StartForm />}

			{dbReady && (
				<section aria-label="Recent exports" className="space-y-1">
					<h3 className="font-display text-[15px]">Recent exports</h3>
					<ActivityList filter={{ target: "export" }} showLabel={false} empty="No exports yet." />
				</section>
			)}
		</div>
	);
}
