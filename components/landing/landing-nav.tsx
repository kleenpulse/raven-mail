"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { RavenMark } from "@/components/shell/raven-mark";
import {
	useActiveSection,
	type SectionId,
} from "@/components/landing/use-active-section";
import { TAB_SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

// Page order, so the highlight walks left to right as you read down.
const LINKS: { id: SectionId; label: string }[] = [
	{ id: "orbit", label: "Orbit" },
	{ id: "overview", label: "Overview" },
	{ id: "ask", label: "Ask Jev" },
	{ id: "privacy", label: "Privacy" },
];

/** Clear over the hero, glass once you scroll; tucks away while reading down. */
export function LandingNav() {
	const { scrollY } = useScroll();
	const [scrolled, setScrolled] = React.useState(false);
	const [tucked, setTucked] = React.useState(false);
	const active = useActiveSection();

	useMotionValueEvent(scrollY, "change", (y) => {
		const delta = y - (scrollY.getPrevious() ?? y);
		setScrolled(y > 24);
		if (y < 480 || delta < -4) setTucked(false);
		else if (delta > 4) setTucked(true);
	});

	return (
		<motion.header
			className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5"
			animate={{ y: tucked ? "-120%" : "0%" }}
			transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
			onFocusCapture={() => setTucked(false)}
		>
			<nav
				aria-label="Main"
				className={cn(
					"mx-auto flex h-14 max-w-[1180px] items-center justify-between gap-4 rounded-pill pr-2 pl-2 transition-[background-color,border-color,box-shadow] duration-300",
					scrolled ? "glass-thin shadow-lift" : "border border-transparent",
				)}
			>
				<a
					href="#top"
					aria-label="raven, back to top"
					className="flex items-center gap-2.5 rounded-pill pr-2"
				>
					<RavenMark className="size-9 [&_svg]:size-[18px]" />
					<span className="font-display text-[17px] tracking-[-0.01em]">
						raven
					</span>
				</a>

				<ul className="hidden items-center gap-0.5 md:flex">
					{LINKS.map((link) => {
						const current = link.id === active;
						return (
							<li key={link.id}>
								<a
									href={`#${link.id}`}
									aria-current={current ? "location" : undefined}
									className={cn(
										"relative isolate block rounded-pill px-3.5 py-2 text-[13px] transition-colors hover:text-foreground",
										current ? "text-foreground" : "text-ink-2",
									)}
								>
									{current && (
										<motion.span
											layoutId="landing-nav-active"
											transition={TAB_SPRING}
											aria-hidden
											className="absolute inset-0 -z-10 rounded-pill bg-signal-soft ring-1 ring-signal/25"
										/>
									)}
									{link.label}
								</a>
							</li>
						);
					})}
				</ul>

				<Link
					href="/login"
					className="group inline-flex h-7 sm:h-10 items-center gap-2 rounded-pill bg-primary px-2.5 sm:pr-4  sm:pl-5 text-[10px] sm:text-[13px] font-medium text-primary-foreground transition-[box-shadow,transform] duration-200 hover:shadow-glow active:scale-[0.98]"
				>
					Open Raven
					<ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
				</Link>
			</nav>
		</motion.header>
	);
}
