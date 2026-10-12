"use client";

import { AlertTriangle, Check, LoaderCircle, Minus, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { StepState, StreamState } from "@/hooks/use-step-stream";
import { duration } from "@/components/integrations/time";
import { cn } from "@/lib/utils";

const ICON_BASE = "relative z-10 grid size-[22px] shrink-0 place-items-center rounded-full";

function StepIcon({ status }: { status: StepState["status"] }) {
	switch (status) {
		case "running":
			return (
				<span className={cn(ICON_BASE, "bg-signal-soft text-signal-ink ring-1 ring-signal/50 dark:text-signal")}>
					<LoaderCircle className="size-3 animate-spin" />
				</span>
			);
		case "ok":
			return (
				<span className={cn(ICON_BASE, "bg-ok text-white dark:text-background")}>
					<Check className="size-3" strokeWidth={3} />
				</span>
			);
		case "warn":
			return (
				<span className={cn(ICON_BASE, "bg-warn text-white dark:text-background")}>
					<AlertTriangle className="size-3" strokeWidth={2.5} />
				</span>
			);
		case "error":
			return (
				<span className={cn(ICON_BASE, "bg-critical text-white")}>
					<X className="size-3" strokeWidth={3} />
				</span>
			);
		case "skipped":
			return (
				<span className={cn(ICON_BASE, "border border-dashed border-border bg-sheet text-ink-3 dark:border-glass-border dark:bg-card-nested")}>
					<Minus className="size-3" />
				</span>
			);
		default:
			return <span className={cn(ICON_BASE, "bg-sheet ring-1 ring-border dark:bg-card-nested dark:ring-glass-border")} />;
	}
}

const FINISHED = new Set(["ok", "warn", "skipped"]);

/**
 * Every planned step is drawn up front and fills in as the stream reports —
 * the rail between icons shows how far along the flow is, and a failure stops
 * on the exact step with the fix underneath.
 */
export function StepList<R>({
	stream,
	onRetry,
	extraAction,
	className,
}: {
	stream: StreamState<R>;
	onRetry?: () => void;
	extraAction?: React.ReactNode;
	className?: string;
}) {
	const { steps, status, error } = stream;
	const finished = steps.filter((s) => FINISHED.has(s.status)).length;
	const total = steps.length;
	const running = steps.find((s) => s.status === "running");
	const elapsed = stream.startedAt !== undefined && stream.finishedAt !== undefined ? stream.finishedAt - stream.startedAt : null;
	const announce =
		status === "running"
			? running
				? `${running.label}…`
				: "Starting…"
			: status === "done"
				? `Done${elapsed !== null ? ` in ${duration(elapsed)}` : ""}.`
				: status === "error"
					? `Stopped: ${error?.message ?? "failed"}`
					: "";

	return (
		<div className={cn("space-y-4", className)}>
			{total > 0 && (
				<Progress
					value={total ? Math.round((finished / total) * 100) : null}
					aria-label="Progress"
					indicatorClassName={cn(status === "error" && "bg-critical", status === "done" && "bg-ok")}
				>
					<span className="font-mono text-[11px] text-ink-2 tabular">
						{finished} of {total}
						{elapsed !== null && ` · ${duration(elapsed)}`}
					</span>
				</Progress>
			)}

			<ol aria-label="Steps" className="relative space-y-0">
				{steps.map((step, i) => {
					const last = i === steps.length - 1;
					const done = FINISHED.has(step.status);
					return (
						<li key={step.id} className="relative flex gap-3 pb-4 last:pb-0">
							{!last && (
								<span
									aria-hidden
									className={cn(
										"absolute top-[22px] bottom-0 left-[10px] w-px transition-colors duration-500",
										done ? "bg-ok/60" : "bg-border dark:bg-glass-border",
									)}
								/>
							)}
							<StepIcon status={step.status} />
							<div className="min-w-0 flex-1 pt-0.5">
								<div className="flex items-baseline justify-between gap-3">
									<p
										className={cn(
											"text-[13px] leading-tight",
											step.status === "pending" ? "text-ink-2" : "text-foreground",
											step.status === "running" && "shimmer",
										)}
									>
										{step.label}
									</p>
									{step.ms !== undefined && (
										<span className="shrink-0 font-mono text-[11px] text-ink-3 tabular">{duration(step.ms)}</span>
									)}
								</div>
								{step.detail && (
									<p
										className={cn(
											"mt-1 text-[12px] leading-snug break-words",
											step.status === "error" ? "text-critical" : step.status === "warn" ? "text-warn" : "text-ink-2",
										)}
									>
										{step.detail}
									</p>
								)}
							</div>
						</li>
					);
				})}
			</ol>

			{status === "error" && error && (
				<div role="alert" className="rounded-[18px] bg-critical/8 px-4 py-3 ring-1 ring-critical/25">
					<p className="text-[13px] font-medium text-foreground">{error.message}</p>
					{error.hint && <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{error.hint}</p>}
					{(onRetry || extraAction) && (
						<div className="mt-3 flex flex-wrap gap-2">
							{onRetry && error.retryable && (
								<Button variant="surface" size="pill-sm" onClick={onRetry}>
									<RotateCw />
									Try again
								</Button>
							)}
							{extraAction}
						</div>
					)}
				</div>
			)}

			<p aria-live="polite" className="sr-only">
				{announce}
			</p>
		</div>
	);
}
