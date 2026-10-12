import { Bento, BentoTitle } from "@/components/overview/bento";
import { HeatDots } from "@/components/viz/heat-dots";
import { formatHour, WEEKDAY_NAMES } from "@/lib/insights/bins";
import { formatDuration } from "@/lib/jev/ask/format";
import type { Overview } from "@/lib/insights/types";

/** Arrival heatmap turned into a schedule: the 2–3 check-ins that catch most human mail. */
export function RhythmCard({ overview, i = 0 }: { overview: Overview; i?: number }) {
	const { rhythm, replyTimes } = overview;
	const checks = rhythm.checkTimes.map((h) => `${formatHour(h)}`).join(" · ");
	return (
		<Bento i={i} className="flex flex-col gap-4">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<BentoTitle>When people write</BentoTitle>
				{checks && (
					<p className="text-[13px] text-ink-2">
						Check at <span className="text-foreground">{checks}</span>
					</p>
				)}
			</div>
			<HeatDots
				grid={rhythm.heat}
				highlightHours={rhythm.checkTimes}
				label={
					rhythm.busiest
						? `Human mail by weekday and hour; busiest ${WEEKDAY_NAMES[rhythm.busiest.weekday]} around ${formatHour(rhythm.busiest.hour)}`
						: "Human mail by weekday and hour"
				}
			/>
			<div className="mt-auto grid gap-3 sm:grid-cols-3">
				<div className="rounded-[18px] bg-card-nested p-3.5 dark:ring-1 dark:ring-glass-border">
					<p className="text-[12px] text-ink-2">Caught within 2h</p>
					<p className="font-display text-kpi-sm tabular">{Math.round(rhythm.checkCoverage * 100)}%</p>
					<p className="text-[11px] text-ink-2">with {rhythm.checkTimes.length || "no"} check-ins</p>
				</div>
				<div className="rounded-[18px] bg-card-nested p-3.5 dark:ring-1 dark:ring-glass-border">
					<p className="text-[12px] text-ink-2">Focus windows</p>
					<p className="mt-1 text-[13px] leading-snug">
						{rhythm.focusWindows.length
							? rhythm.focusWindows.map((w) => `${formatHour(w.start)}–${formatHour(w.end)}`).join(", ")
							: "—"}
					</p>
				</div>
				<div className="rounded-[18px] bg-card-nested p-3.5 dark:ring-1 dark:ring-glass-border">
					<p className="text-[12px] text-ink-2">Reply time</p>
					<p className="font-display text-kpi-sm tabular">{formatDuration(replyTimes.yours.medianMin)}</p>
					<p className="text-[11px] text-ink-2">
						yours · theirs {formatDuration(replyTimes.theirs.medianMin)}
					</p>
				</div>
			</div>
		</Bento>
	);
}
