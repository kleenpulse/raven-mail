import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type AnalysisItem = {
	tone: "critical" | "suggest";
	title: string;
	ref: string;
	body: string;
};

/** Video's "RI ANALYSIS" panel, as Jev's structured findings. */
export function AnalysisCard({
	items,
	confidence,
	className,
}: {
	items: AnalysisItem[];
	confidence?: number;
	className?: string;
}) {
	return (
		<div className={cn("glass rounded-card p-4 shadow-lift", className)}>
			<div className="flex items-center justify-between px-1 pb-3">
				<p className="font-mono text-[11px] tracking-[0.14em] text-ink-2">
					<span className="text-signal-ink dark:text-signal">JEV</span> ANALYSIS
				</p>
				{confidence !== undefined && (
					<span className="tabular rounded-pill bg-card-nested px-2.5 py-1 font-mono text-[11px] text-ink-2 ring-1 ring-border dark:ring-glass-border">
						{Math.round(confidence * 100)}% sure
					</span>
				)}
			</div>
			<ul className="space-y-2.5">
				{items.map((item) => (
					<li
						key={item.title}
						className={cn(
							"relative rounded-[18px] bg-card px-4 py-3.5 dark:bg-card-nested",
							// opaque fill under the conic border: card in Ember, popover in Nebula (card is translucent there)
							item.tone === "critical" && "glow-sweep [--card-sweep-fill:var(--card)] dark:[--card-sweep-fill:var(--popover)]",
						)}
					>
						<div className="flex items-baseline justify-between gap-3">
							<p className="flex items-baseline gap-2 text-[15px] font-medium">
								<span
									aria-hidden
									className={cn(
										"font-mono text-base",
										item.tone === "critical" ? "text-critical" : "text-signal-2 dark:text-signal-2",
									)}
								>
									[
								</span>
								{item.title}
							</p>
							<span className="flex shrink-0 items-center gap-1 text-xs text-ink-2">
								{item.ref}
								<ArrowUpRight className="size-3.5" />
							</span>
						</div>
						<p className="mt-1 pl-4 text-[13px] leading-relaxed text-ink-2">{item.body}</p>
					</li>
				))}
			</ul>
		</div>
	);
}
