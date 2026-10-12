"use client";

import { AlertTriangle, CheckCircle2, RotateCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ago, dayLabel, duration } from "@/components/integrations/time";
import { useIntegrationEvents } from "@/hooks/use-integrations";
import { useNow } from "@/hooks/use-now";
import type { EventTarget, IntegrationEventDTO } from "@/lib/integrations/types";
import { cn } from "@/lib/utils";

const OUTCOME = {
	ok: { Icon: CheckCircle2, className: "text-ok" },
	warn: { Icon: AlertTriangle, className: "text-warn" },
	error: { Icon: XCircle, className: "text-critical" },
} as const;

function groupByDay(events: IntegrationEventDTO[], now: number) {
	const groups: { day: string; events: IntegrationEventDTO[] }[] = [];
	for (const event of events) {
		const day = dayLabel(event.createdAt, now);
		const last = groups.at(-1);
		if (last?.day === day) last.events.push(event);
		else groups.push({ day, events: [event] });
	}
	return groups;
}

function EventRow({ event, now, showLabel }: { event: IntegrationEventDTO; now: number; showLabel: boolean }) {
	const { Icon, className } = OUTCOME[event.outcome];
	const meta = [
		showLabel && event.label,
		event.latencyMs !== null && duration(event.latencyMs),
		event.attempts !== null && event.attempts > 1 && `${event.attempts} tries`,
		ago(event.createdAt, now),
	].filter(Boolean);
	return (
		<li className="flex gap-3 py-2.5">
			<Icon aria-label={event.outcome} className={cn("mt-0.5 size-4 shrink-0", className)} />
			<div className="min-w-0 flex-1">
				<p className="text-[13px] leading-snug break-words">{event.summary}</p>
				<p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-2">
					<span className="tabular">{meta.join(" · ")}</span>
					{event.errorCode && (
						<code className="rounded-pill bg-card-nested px-1.5 py-px font-mono text-[10px] text-ink-2 ring-1 ring-border dark:ring-glass-border">
							{event.errorCode}
						</code>
					)}
				</p>
			</div>
		</li>
	);
}

/** Paged, grouped by day. `compact` trims to the first page with no pager (board feed). */
export function ActivityList({
	filter = {},
	compact = false,
	showLabel = true,
	empty = "Nothing has happened here yet.",
	className,
}: {
	filter?: { integrationId?: string; target?: EventTarget };
	compact?: boolean;
	showLabel?: boolean;
	empty?: string;
	className?: string;
}) {
	const now = useNow();
	const query = useIntegrationEvents(filter);
	const events = query.data?.pages.flatMap((p) => p.events) ?? [];
	const shown = compact ? events.slice(0, 8) : events;

	if (query.isPending || now === null) {
		return (
			<div aria-busy="true" className={cn("space-y-3 py-2", className)}>
				{[0, 1, 2].map((i) => (
					<div key={i} className="flex animate-pulse gap-3">
						<span className="size-4 rounded-full bg-card-nested" />
						<span className="h-3.5 flex-1 rounded-full bg-card-nested" />
					</div>
				))}
			</div>
		);
	}

	if (query.isError) {
		return (
			<div role="alert" className={cn("flex flex-wrap items-center gap-3 py-2 text-[12px] text-ink-2", className)}>
				<span>Couldn’t load activity: {query.error.message}</span>
				<Button variant="surface" size="pill-sm" onClick={() => void query.refetch()}>
					<RotateCw />
					Retry
				</Button>
			</div>
		);
	}

	if (shown.length === 0) return <p className={cn("py-3 text-[12px] text-ink-2", className)}>{empty}</p>;

	return (
		<div className={className}>
			{groupByDay(shown, now).map((group) => (
				<section key={group.day} aria-label={group.day}>
					<h4 className="readout pt-2">{group.day}</h4>
					<ul className="divide-y divide-border dark:divide-glass-border">
						{group.events.map((event) => (
							<EventRow key={event.id} event={event} now={now} showLabel={showLabel} />
						))}
					</ul>
				</section>
			))}
			{!compact && query.hasNextPage && (
				<Button
					variant="surface"
					size="pill-sm"
					className="mt-3"
					disabled={query.isFetchingNextPage}
					onClick={() => void query.fetchNextPage()}
				>
					{query.isFetchingNextPage ? "Loading…" : "Load older"}
				</Button>
			)}
		</div>
	);
}
