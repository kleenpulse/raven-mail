"use client";

import * as React from "react";
import { ReactLenis, type LenisRef } from "lenis/react";
import { cancelFrame, frame } from "motion/react";
import "lenis/dist/lenis.css";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * Lenis on the window — landing only: app pages scroll inner panes, which a
 * root instance would hijack. It steps inside Motion's frame loop, so
 * scroll-linked transforms and the scroll position move on the same clock.
 */
export function SmoothScroll() {
	const reduced = useReducedMotion();
	const ref = React.useRef<LenisRef>(null);

	React.useEffect(() => {
		if (reduced) return;
		const update = ({ timestamp }: { timestamp: number }) => ref.current?.lenis?.raf(timestamp);
		frame.update(update, true);
		return () => cancelFrame(update);
	}, [reduced]);

	if (reduced) return null;
	// Anchor offsets come from each section's scroll-margin-top, which Lenis reads.
	return <ReactLenis root ref={ref} options={{ autoRaf: false, anchors: true, stopInertiaOnNavigate: true }} />;
}
