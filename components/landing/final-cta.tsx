"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion, useInView, useScroll, useTransform } from "motion/react";
import { RavenMark } from "@/components/shell/raven-mark";
import { HorizonAurora } from "@/components/landing/horizon-aurora";
import { NightSky } from "@/components/landing/night-sky";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/** The page ends at first light: gold smoke rises off the footer's horizon as you arrive. */
export function FinalCta() {
	const ref = React.useRef<HTMLElement>(null);
	const reduced = useReducedMotion();
	const inView = useInView(ref);
	const { scrollYProgress } = useScroll({
		target: ref,
		offset: ["start end", "end end"],
	});
	const rise = useTransform(scrollYProgress, [0, 1], ["34%", "0%"]);
	const glow = useTransform(scrollYProgress, [0.15, 1], [0.3, 1]);

	return (
		<section
			ref={ref}
			id="start"
			aria-labelledby="cta-title"
			className="relative isolate scroll-mt-20 overflow-hidden pt-28 pb-52 sm:pt-36 sm:pb-64"
		>
			<NightSky
				density={0.45}
				className="mask-[linear-gradient(to_bottom,black_55%,transparent)]"
			/>
			{/* Anchored to the section's bottom edge, so the footer hairline reads as the horizon. */}
			<motion.div
				aria-hidden
				style={reduced ? { y: "0%", opacity: 1 } : { y: rise, opacity: glow }}
				className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[520px]"
			>
				<HorizonAurora paused={!inView} reducedMotion={reduced} className="absolute inset-0" />
			</motion.div>

			<div className="relative mx-auto max-w-[900px] px-5 text-center">
				<RavenMark className="mx-auto size-16 [&_svg]:size-8" />
				<h2
					id="cta-title"
					className="mt-9 font-display text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.98] tracking-[-0.04em]"
				>
					Open the brief.
				</h2>
				<p className="mx-auto mt-6 max-w-[32rem] text-[17px] leading-relaxed text-pretty text-ink-2">
					Connect Gmail, Outlook, iCloud, Fastmail or any IMAP mailbox. Your
					overview builds the moment you sign in.
				</p>
				<div className="mt-10 flex flex-wrap items-center justify-center gap-3">
					<Link
						href="/login"
						className="group inline-flex h-12 items-center gap-2.5 rounded-pill bg-primary pr-5 pl-6 text-sm font-medium text-primary-foreground transition-[box-shadow,transform] duration-200 hover:shadow-glow active:scale-[0.98]"
					>
						Connect your mailbox
						<ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
					</Link>
				</div>
				<p className="readout mt-7 text-balance">IMAP · SMTP · encrypted session</p>
			</div>
		</section>
	);
}
