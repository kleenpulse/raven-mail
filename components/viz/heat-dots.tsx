import { cn } from "@/lib/utils";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * 7×24 arrival grid as a dot matrix: dot radius + opacity encode volume,
 * highlighted hours (check times) get the signal color.
 */
export function HeatDots({
	grid,
	highlightHours = [],
	className,
	label,
}: {
	grid: number[][];
	highlightHours?: number[];
	className?: string;
	label: string;
}) {
	const max = Math.max(1, ...grid.flat());
	const cell = 14;
	const width = 34 + 24 * cell;
	const height = 7 * cell + 18;
	return (
		<svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className={cn("w-full", className)}>
			{DAYS.map((d, row) => (
				<text key={d} x={0} y={row * cell + 10} className="fill-ink-3 font-mono text-[8px]">
					{d}
				</text>
			))}
			{grid.map((hours, row) =>
				hours.map((v, h) => {
					const t = v / max;
					const hot = highlightHours.includes(h);
					return (
						<circle
							key={`${row}-${h}`}
							cx={34 + h * cell + cell / 2}
							cy={row * cell + cell / 2}
							r={1.4 + t * 4.2}
							className={hot ? "fill-signal" : "fill-foreground"}
							opacity={hot ? 0.35 + t * 0.65 : 0.1 + t * 0.55}
						/>
					);
				}),
			)}
			{[0, 6, 12, 18].map((h) => (
				<text key={h} x={34 + h * cell + 2} y={height - 2} className="fill-ink-3 font-mono text-[8px]">
					{String(h).padStart(2, "0")}
				</text>
			))}
		</svg>
	);
}
