import { cn } from "@/lib/utils";

/**
 * Wipes in once, then the endpoint pulses a single time. The line stretches to
 * any width; the dot is HTML so it stays round.
 */
export function Sparkline({
	values,
	label,
	className,
	height = 64,
}: {
	values: number[];
	label: string;
	className?: string;
	height?: number;
}) {
	const w = 240;
	const h = height;
	const max = Math.max(1, ...values);
	const min = Math.min(0, ...values);
	const pts = values.map((v, i) => {
		const x = values.length <= 1 ? w : (i / (values.length - 1)) * w;
		const y = h - 6 - ((v - min) / (max - min || 1)) * (h - 12);
		return [x, y] as const;
	});
	const d = pts
		.map(([x, y], i) => {
			if (i === 0) return `M${x},${y}`;
			const [px, py] = pts[i - 1]!;
			const cx = (px + x) / 2;
			return `C${cx},${py} ${cx},${y} ${x},${y}`;
		})
		.join(" ");
	const end = pts[pts.length - 1];
	return (
		<div className={cn("wipe-in relative w-full", className)} style={{ height }}>
			<svg
				viewBox={`0 0 ${w} ${h}`}
				preserveAspectRatio="none"
				role="img"
				aria-label={label}
				className="absolute inset-0 size-full overflow-visible"
			>
				{d && (
					<path
						d={d}
						fill="none"
						vectorEffect="non-scaling-stroke"
						strokeWidth={2}
						strokeLinecap="round"
						className="stroke-signal"
					/>
				)}
			</svg>
			{end && (
				<span
					aria-hidden
					className="absolute size-[7px] -translate-1/2 rounded-full bg-signal"
					style={{ left: `${(end[0] / w) * 100}%`, top: `${(end[1] / h) * 100}%` }}
				>
					<span className="absolute inset-0 animate-pulse-once rounded-full bg-signal" style={{ animationDelay: "1100ms" }} />
				</span>
			)}
		</div>
	);
}
