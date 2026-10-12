import { cn } from "@/lib/utils";

export type Ring = { key: string; label: string; value: number };

const TONES = [
	"fill-signal-soft dark:fill-orb-2/15",
	"fill-signal/25 dark:fill-orb-3/25",
	"fill-signal/55 dark:fill-orb-4/40",
	"fill-signal dark:fill-signal",
];

/**
 * The reference's "Annual profits" nested circles: area ∝ value, drawn
 * largest → smallest from a shared bottom tangent, blooming in with a stagger.
 */
export function Concentric({
	rings,
	onSelect,
	className,
	label,
}: {
	rings: Ring[];
	onSelect?: (ring: Ring) => void;
	className?: string;
	label: string;
}) {
	const sorted = [...rings].sort((a, b) => b.value - a.value);
	const max = Math.max(1, sorted[0]?.value ?? 1);
	const size = 260;
	const maxR = size / 2 - 4;
	const circles = sorted.map((ring, i) => {
		const r = Math.max(26, Math.sqrt(ring.value / max) * maxR);
		const cy = size - 4 - r;
		const dark = i === sorted.length - 1;
		return { ring, r, cy, dark, labelY: cy - r + (dark ? r : 22) };
	});
	// Near-equal rings share almost the same top edge; drop a label that would land on the one above.
	const shown = circles.reduce<{ last: number; show: boolean[] }>(
		(acc, c) => {
			const show = c.dark || c.labelY - acc.last >= 16;
			return { last: show ? c.labelY : acc.last, show: [...acc.show, show] };
		},
		{ last: -Infinity, show: [] },
	).show;
	return (
		<svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className={cn("w-full", className)}>
			{circles.map(({ ring, r, cy, dark, labelY }, i) => {
				const tone = TONES[Math.min(TONES.length - 1, i + (TONES.length - sorted.length))]!;
				const showLabel = shown[i];
				return (
					<g
						key={ring.key}
						className={cn("animate-bloom", onSelect && "cursor-pointer")}
						style={{ transformOrigin: `${size / 2}px ${size - 4}px`, animationDelay: `${i * 110}ms` }}
						onClick={onSelect ? () => onSelect(ring) : undefined}
					>
						<circle cx={size / 2} cy={cy} r={r} className={tone} />
						{showLabel && (
							<text
								x={size / 2}
								y={labelY}
								textAnchor="middle"
								dominantBaseline={dark ? "middle" : "auto"}
								className={cn(
									"font-display text-[15px] tabular",
									dark ? "fill-white dark:fill-inverse-foreground" : "fill-foreground",
								)}
							>
								{ring.value.toLocaleString()}
							</text>
						)}
					</g>
				);
			})}
		</svg>
	);
}
