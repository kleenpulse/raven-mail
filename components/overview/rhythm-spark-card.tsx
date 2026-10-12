import { Bento } from "@/components/overview/bento";
import { CountUp } from "@/components/viz/count-up";
import { Sparkline } from "@/components/viz/sparkline";
import type { Overview } from "@/lib/insights/types";
import { cn } from "@/lib/utils";

/** The reference's "Main Stocks" card: 30-day arrivals line + week-over-week move. */
export function RhythmSparkCard({ overview, i = 0 }: { overview: Overview; i?: number }) {
	const { volume } = overview;
	const pct = volume.receivedLastWeek
		? Math.round(((volume.receivedThisWeek - volume.receivedLastWeek) / volume.receivedLastWeek) * 1000) / 10
		: null;
	const values = volume.days.map((d) => d.received);
	return (
		<Bento i={i} className="flex flex-col gap-3">
			<div className="flex items-start justify-between gap-3">
				<div>
					<p className="text-[13px] text-ink-2">This week</p>
					<CountUp value={volume.receivedThisWeek} className="font-display text-kpi-sm" />
				</div>
				{pct !== null && (
					<span
						className={cn(
							"tabular rounded-pill px-2.5 py-1 font-mono text-[12px] ring-1",
							pct > 0 ? "text-signal-ink ring-signal/30" : "text-ok ring-ok/30",
						)}
					>
						{pct > 0 ? "+" : ""}
						{pct}%
					</span>
				)}
			</div>
			<Sparkline values={values} label={`Emails received per day over 30 days, latest ${values.at(-1) ?? 0}`} />
			<div>
				<p className="font-display text-[17px] leading-tight">Arrival rhythm</p>
				<p className="text-[12px] text-ink-2">30 days · all mail received</p>
			</div>
		</Bento>
	);
}
