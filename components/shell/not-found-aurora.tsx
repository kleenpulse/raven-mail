"use client";

import { HorizonAurora } from "@/components/landing/horizon-aurora";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/** The landing page's first light, rising off the 404's bottom edge. */
export function NotFoundAurora() {
	const reduced = useReducedMotion();
	return (
		<div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[520px]">
			<HorizonAurora reducedMotion={reduced} className="absolute inset-0" />
		</div>
	);
}
