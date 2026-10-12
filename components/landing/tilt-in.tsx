"use client";

import * as React from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * A product surface that lies back, then stands up as you scroll to it.
 * Needs a `[perspective:…]` parent for the depth to read.
 */
export function TiltIn({
	children,
	className,
	tilt = 16,
}: {
	children: React.ReactNode;
	className?: string;
	/** Starting rotateX, degrees. */
	tilt?: number;
}) {
	const ref = React.useRef<HTMLDivElement>(null);
	const reduced = useReducedMotion();
	const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start 0.3"] });
	const rotateX = useTransform(scrollYProgress, [0, 1], [tilt, 0]);
	const scale = useTransform(scrollYProgress, [0, 1], [0.92, 1]);
	const opacity = useTransform(scrollYProgress, [0, 0.45], [0.4, 1]);

	return (
		<motion.div
			ref={ref}
			className={cn("origin-top will-change-transform", className)}
			// Static values (not `undefined`) under reduced motion, so no stale inline transform survives.
			style={reduced ? { rotateX: 0, scale: 1, opacity: 1 } : { rotateX, scale, opacity }}
		>
			{children}
		</motion.div>
	);
}
