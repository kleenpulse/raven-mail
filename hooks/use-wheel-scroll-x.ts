"use client";

import * as React from "react";

const LINE_PX = 40;

/**
 * Lets a vertical mouse wheel scroll a horizontal rail while the pointer is
 * over it. Trackpad sideways swipes pass through untouched, and at either end
 * the wheel goes back to scrolling the page.
 */
export function useWheelScrollX(ref: React.RefObject<HTMLElement | null>) {
	React.useEffect(() => {
		const el = ref.current;
		if (!el) return;
		function onWheel(e: WheelEvent) {
			if (!el || e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
			const max = el.scrollWidth - el.clientWidth;
			if (max <= 0) return;
			const delta = e.deltaY * (e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? el.clientWidth : 1);
			if ((delta < 0 && el.scrollLeft <= 0) || (delta > 0 && el.scrollLeft >= max - 1)) return;
			e.preventDefault();
			el.scrollLeft += delta;
		}
		// Non-passive, or preventDefault can't stop the page scrolling underneath.
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [ref]);
}
