"use client";

import { useCountUp } from "@/hooks/use-count-up";
import { cn } from "@/lib/utils";

/** Animated figure with a stable, screen-reader-only final value. */
export function CountUp({
	value,
	format = (n) => Math.round(n).toLocaleString(),
	delay = 0,
	className,
}: {
	value: number;
	format?: (n: number) => string;
	delay?: number;
	className?: string;
}) {
	const shown = useCountUp(value, { delay });
	return (
		<span className={cn("tabular", className)}>
			<span aria-hidden>{format(shown)}</span>
			<span className="sr-only">{format(value)}</span>
		</span>
	);
}
