"use client";

import * as React from "react";

// Page order. Every id is a scroll target carrying its own scroll-margin-top.
export const SECTIONS = [
	{ id: "top", label: "Top" },
	{ id: "orbit", label: "Orbit" },
	{ id: "overview", label: "Overview" },
	{ id: "ask", label: "Ask Jev" },
	{ id: "privacy", label: "Privacy" },
	{ id: "workflow", label: "Workflow" },
	{ id: "start", label: "Open the brief" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

// A section is current once its top crosses this line. Deeper than the widest
// scroll-margin (orbit's 96px), so a jump never hands the highlight straight back.
const ACTIVE_LINE = 120;

/** The last section whose top crossed the line; the final one once the page bottoms out. */
function activeAt(): SectionId {
	const limit = document.documentElement.scrollHeight - window.innerHeight;
	if (window.scrollY >= limit - 2) return SECTIONS[SECTIONS.length - 1].id;
	let current: SectionId = SECTIONS[0].id;
	for (const s of SECTIONS) {
		const el = document.getElementById(s.id);
		if (el && el.getBoundingClientRect().top <= ACTIVE_LINE) current = s.id;
	}
	return current;
}

/**
 * Scroll-spy shared by the nav and the section rail. Lenis drives the native
 * scroll position, so one rAF-throttled scroll listener covers both smooth and
 * reduced-motion scrolling.
 */
export function useActiveSection(): SectionId {
	const [active, setActive] = React.useState<SectionId>(SECTIONS[0].id);

	React.useEffect(() => {
		let frame = 0;
		const measure = () => {
			frame = 0;
			setActive(activeAt());
		};
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(measure);
		};
		schedule();
		window.addEventListener("scroll", schedule, { passive: true });
		window.addEventListener("resize", schedule);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", schedule);
		};
	}, []);

	return active;
}
