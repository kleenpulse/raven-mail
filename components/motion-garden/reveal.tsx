"use client";

// Adapted from Motion Garden's landing — scroll-in reveal. Server-rendered children
// pass through. The initial style never branches on the motion preference (SSR
// can't know it); reduced motion lands the same animation instantly instead.

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

export function Reveal({
	children,
	delay = 0,
	y = 16,
	className,
}: {
	children: ReactNode;
	delay?: number;
	y?: number;
	className?: string;
}) {
	const reduce = useReducedMotion();

	return (
		<motion.div
			className={className}
			initial={{ opacity: 0, y }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: true, margin: "-80px" }}
			transition={reduce ? { duration: 0 } : { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
		>
			{children}
		</motion.div>
	);
}
