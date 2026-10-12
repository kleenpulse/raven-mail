import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Goal-completion ring (research: rings only for progress, never comparisons).
 * Sweeps from 12 o'clock; the disc variant mirrors the reference's black dial.
 */
export function Ring({
	value,
	size = 132,
	stroke = 10,
	label,
	children,
	className,
	delay = 260,
}: {
	value: number;
	size?: number;
	stroke?: number;
	label: string;
	children?: ReactNode;
	className?: string;
	delay?: number;
}) {
	const clamped = Math.max(0, Math.min(100, value));
	const r = (size - stroke) / 2 - 6;
	return (
		<div
			role="img"
			aria-label={label}
			className={cn(
				"relative inline-grid place-items-center rounded-full bg-inverse text-inverse-foreground",
				"dark:bg-card-nested dark:text-foreground dark:ring-1 dark:ring-glass-border",
				className,
			)}
			style={{ width: size, height: size }}
		>
			<svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
				<circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.14} strokeWidth={stroke} />
				<circle
					cx={size / 2}
					cy={size / 2}
					r={r}
					fill="none"
					pathLength={100}
					strokeWidth={stroke}
					strokeLinecap="round"
					className="ring-sweep stroke-signal"
					style={{ strokeDashoffset: 100 - clamped, ["--draw-delay" as string]: `${delay}ms` }}
				/>
			</svg>
			<div className="relative text-center">{children}</div>
		</div>
	);
}
