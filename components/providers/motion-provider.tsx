"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { usePref } from "@/lib/prefs/store";

/**
 * Motion skips transform/layout animation for people who ask the OS for
 * reduced motion, or who pick Reduce Motion in Settings → Appearance.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
	const motion = usePref("appearance.motion");
	return <MotionConfig reducedMotion={motion === "reduce" ? "always" : "user"}>{children}</MotionConfig>;
}
