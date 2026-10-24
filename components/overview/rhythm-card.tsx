import { Bento, BentoTitle } from "@/components/overview/bento";
import { HeatDots } from "@/components/viz/heat-dots";
import { formatHour, WEEKDAY_NAMES } from "@/lib/insights/bins";
import type { Overview } from "@/lib/insights/types";

/** Arrival heatmap turned into a schedule: the 2–3 check-ins that catch most human mail. */
export function RhythmCard({ overview, i = 0 }: { overview: Overview; i?: number }) {
	const { rhythm } = overview;
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
		</Bento>
	);
}
