"use client";

import * as React from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Bento } from "@/components/overview/bento";
import { CountUp } from "@/components/viz/count-up";
import { Bars } from "@/components/viz/bars";
import type { Overview } from "@/lib/insights/types";
import { cn } from "@/lib/utils";

type Span = "7" | "30";

function Delta({ now, before }: { now: number; before: number }) {
	if (!before) return null;
	const pct = Math.round(((now - before) / before) * 100);
	return (
		<span
			className={cn(
				"tabular rounded-pill px-2 py-0.5 font-mono text-[11px] ring-1",
				pct > 0 ? "text-signal-ink ring-signal/30" : "text-ok ring-ok/30",
			)}
		>
			{pct > 0 ? "+" : ""}
			{pct}% vs last week
		</span>
	);
}

/** The reference's twin "Total income / Total paid" cards → received vs sent. */
export function VolumeCard({ overview, i = 0 }: { overview: Overview; i?: number }) {
	const [span, setSpan] = React.useState<Span>("7");
	const days = overview.volume.days.slice(-Number(span));
	const received = days.reduce((s, d) => s + d.received, 0);
	const sent = days.reduce((s, d) => s + d.sent, 0);
	const weekly = span === "7";

	return (
		<Bento i={i} className="flex flex-col gap-2.5 p-2.5">
			<div className="rounded-[22px] bg-card-nested p-4 dark:ring-1 dark:ring-glass-border">
				<div className="flex items-center justify-between gap-2">
					<span className="grid size-9 place-items-center rounded-full ring-1 ring-border dark:ring-glass-border">
						<ArrowDownLeft className="size-4" />
					</span>
					<ToggleGroup
						value={[span]}
						onValueChange={(next) => {
							const v = next[0] as Span | undefined;
							if (v) setSpan(v);
						}}
						variant="pill"
						size="pill"
						spacing={0}
						className="rounded-pill p-0.5 ring-1 ring-border dark:ring-glass-border"
					>
						<ToggleGroupItem value="7" className="h-7 min-w-0 px-3 text-xs">
							Weekly
						</ToggleGroupItem>
						<ToggleGroupItem value="30" className="h-7 min-w-0 px-3 text-xs">
							Monthly
						</ToggleGroupItem>
					</ToggleGroup>
				</div>
				<p className="mt-3 text-[13px] text-ink-2">Received</p>
				<div className="mt-1 flex flex-wrap items-baseline gap-2">
					<CountUp key={`r${span}`} value={received} className="font-display text-kpi-sm" />
					{weekly && <Delta now={overview.volume.receivedThisWeek} before={overview.volume.receivedLastWeek} />}
				</div>
				<Bars values={days.map((d) => d.received)} label={`Received per day: ${days.map((d) => d.received).join(", ")}`} className="mt-3" height={40} />
			</div>

			<div className="rounded-[22px] bg-card-nested p-4 dark:ring-1 dark:ring-glass-border">
				<div className="flex items-center justify-between">
					<span className="grid size-9 place-items-center rounded-full ring-1 ring-border dark:ring-glass-border">
						<ArrowUpRight className="size-4" />
					</span>
					<span className="font-mono text-[11px] text-ink-2">{weekly ? "last 7 days" : "last 30 days"}</span>
				</div>
				<p className="mt-3 text-[13px] text-ink-2">Sent</p>
				<div className="mt-1 flex flex-wrap items-baseline gap-2">
					<CountUp key={`s${span}`} value={sent} className="font-display text-kpi-sm" delay={80} />
					{weekly && <Delta now={overview.volume.sentThisWeek} before={overview.volume.sentLastWeek} />}
				</div>
			</div>
		</Bento>
	);
}
