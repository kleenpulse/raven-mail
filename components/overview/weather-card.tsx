import { Bento, BentoTitle } from "@/components/overview/bento";
import { CountUp } from "@/components/viz/count-up";
import { Ring } from "@/components/viz/ring";
import type { Overview } from "@/lib/insights/types";

/** Inbox weather: one calm→stormy score, measured against your own usual day. */
export function WeatherCard({ overview, i = 0 }: { overview: Overview; i?: number }) {
	const { weather, kpis } = overview;
	return (
		<Bento i={i} className="flex flex-col">
			<BentoTitle>Inbox weather</BentoTitle>
			<p className="mt-1 text-[13px] text-ink-2">{weather.forecast}</p>
			<div className="flex flex-1 items-center justify-center py-4">
				<Ring value={weather.score} label={`Inbox health ${weather.score} of 100, ${weather.label}`} size={124}>
					<CountUp value={weather.score} className="block font-display text-[32px] leading-none" delay={200} />
					<span className="mt-1 block text-xs opacity-70">{weather.label}</span>
				</Ring>
			</div>
			<p className="text-[13px] text-ink-2">
				{kpis.urgentToday > 0 ? (
					<span className="text-foreground">{kpis.urgentToday} urgent today</span>
				) : (
					<span className="text-foreground">Nothing urgent</span>
				)}{" "}
				· {kpis.receivedToday} arrived so far
			</p>
		</Bento>
	);
}
