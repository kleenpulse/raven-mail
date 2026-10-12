import { cn } from "@/lib/utils";

/** Thin vertical bars like the reference's activity chart; last bar in signal. */
export function Bars({
	values,
	label,
	highlightLast = true,
	className,
	height = 72,
	fill = false,
}: {
	values: number[];
	label: string;
	highlightLast?: boolean;
	className?: string;
	height?: number;
	/** Grow to the parent's free height (give it a min-height); `height` then only sets the drawing scale. */
	fill?: boolean;
}) {
	const max = Math.max(1, ...values);
	const w = 100 / Math.max(1, values.length);
	return (
		<svg
			viewBox={`0 0 100 ${height}`}
			preserveAspectRatio="none"
			role="img"
			aria-label={label}
			className={cn("w-full", className)}
			style={fill ? undefined : { height }}
		>
			{values.map((v, i) => {
				const h = Math.max(2, (v / max) * (height - 4));
				const last = highlightLast && i === values.length - 1;
				return (
					<rect
						key={i}
						x={i * w + w * 0.34}
						y={height - h}
						width={w * 0.32}
						height={h}
						rx={Math.min(1.5, w * 0.16)}
						className={last ? "fill-signal" : "fill-foreground/30"}
					/>
				);
			})}
		</svg>
	);
}
