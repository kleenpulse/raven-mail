"use client";

import * as React from "react";
import { useInView } from "motion/react";
import { Starfield } from "@/components/motion-garden/starfield";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/** Nebula's backdrop stars — the canvas only runs while it's on screen. */
export function NightSky({ className, density = 0.55 }: { className?: string; density?: number }) {
	const ref = React.useRef<HTMLDivElement>(null);
	const inView = useInView(ref);
	const reduced = useReducedMotion();

	return (
		<div ref={ref} aria-hidden className={cn("pointer-events-none absolute inset-0 -z-10", className)}>
			<Starfield
				starColor="#cfe2df"
				accentColor="#e6c27a"
				density={density}
				layers={3}
				driftSpeed={0.22}
				twinkle={0.55}
				shootingStars={0.12}
				glow={5}
				paused={!inView}
				reducedMotion={reduced}
			/>
		</div>
	);
}
