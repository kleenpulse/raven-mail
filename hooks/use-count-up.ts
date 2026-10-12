"use client";

import * as React from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;

/**
 * First paint counts up (~800ms); later changes roll quickly (~220ms) so live
 * updates read as a nudge, not a replay.
 */
export function useCountUp(target: number, { delay = 0 }: { delay?: number } = {}): number {
	const reduced = useReducedMotion();
	const [value, setValue] = React.useState(0);
	const from = React.useRef(0);
	const settled = React.useRef(false);

	React.useEffect(() => {
		if (reduced) {
			// Rendered value short-circuits to target below; just keep the refs in sync.
			from.current = target;
			settled.current = true;
			return;
		}
		const duration = settled.current ? 220 : 820;
		const origin = from.current;
		const start = performance.now() + (settled.current ? 0 : delay);
		let raf = 0;
		const tick = (now: number) => {
			const t = Math.min(1, Math.max(0, (now - start) / duration));
			setValue(origin + (target - origin) * easeOutQuart(t));
			if (t < 1) {
				raf = requestAnimationFrame(tick);
			} else {
				from.current = target;
				settled.current = true;
			}
		};
		raf = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(raf);
			from.current = target;
		};
	}, [target, delay, reduced]);

	return reduced ? target : value;
}
