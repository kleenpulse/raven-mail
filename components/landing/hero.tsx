import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Bento, BentoTitle } from "@/components/overview/bento";
import { Orbit } from "@/components/overview/orbit";
import { LettersPull } from "@/components/motion-garden/letters-pull";
import { DemoBadge, DemoGuard } from "@/components/landing/demo-guard";
import { NightSky } from "@/components/landing/night-sky";
import { TiltIn } from "@/components/landing/tilt-in";
import type { Overview } from "@/lib/insights/types";

export function Hero({
	senders,
	categories,
}: Pick<Overview, "senders" | "categories">) {
	return (
		<section
			id="top"
			aria-labelledby="hero-title"
			className="relative isolate overflow-x-clip pt-32 sm:pt-40"
		>
			<NightSky className="mask-[radial-gradient(120%_70%_at_50%_0%,black_35%,transparent_80%)]" />
			{/* The sun behind "You": the constellation below rises into its glow. */}
			<div
				aria-hidden
				className="pointer-events-none absolute top-[520px] left-1/2 -z-10 size-[min(1100px,140vw)] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(230_194_122/0.16),rgb(94_225_217/0.05)_55%,transparent)]"
			/>

			<div className="relative mx-auto max-w-[1180px] px-5 text-center">
				<p className="readout mx-auto inline-flex h-8 items-center gap-2 rounded-pill bg-card-nested px-3.5 ring-1 ring-glass-border">
					<span
						aria-hidden
						className="size-1.5 rounded-full bg-signal shadow-[0_0_10px_var(--signal)]"
					/>
					<span>
						Self-hosted email client
						<span className="hidden sm:inline">
							{" "}
							· Gmail, Outlook & any IMAP
						</span>
					</span>
				</p>

				<h1
					id="hero-title"
					className="mt-8 font-display text-[clamp(3.25rem,10vw,7.75rem)] leading-[0.94] tracking-[-0.045em]"
				>
					<LettersPull text="Your inbox," /> <br />
					<LettersPull
						text="briefed."
						startDelay={0.36}
						className="text-signal [text-shadow:0_0_48px_rgb(230_194_122/0.35)]"
					/>
				</h1>

				<p className="mx-auto mt-7 max-w-[35rem] text-[17px] leading-relaxed text-pretty text-ink-2">
					Raven reads the last thirty days of your mail and briefs you: who’s
					waiting on a reply, who owes you one, and what can wait before you
					open a single thread.
				</p>

				<div className="mt-10 flex flex-wrap items-center justify-center gap-3 w-full">
					<Link
						href="/login"
						className="group inline-flex h-10 sm:h-12 items-center gap-2.5 rounded-pill bg-primary px-4 sm:pr-5 sm:pl-6 text-sm font-medium text-primary-foreground transition-[box-shadow,transform] duration-200 hover:shadow-glow active:scale-[0.98] "
					>
						Connect your mailbox
						<ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
					</Link>
					<a
						href="#overview"
						className="inline-flex h-10 sm:h-12 items-center rounded-pill px-4 sm:px-6 text-sm ring-1 ring-glass-border transition-colors hover:bg-card-nested "
					>
						Take the tour
					</a>
				</div>
				<p className="readout mt-7 text-balance">
					Self-hosted · no password database · trackers blocked
				</p>
			</div>

			<div
				id="orbit"
				className="relative mx-auto mt-16 max-w-[1180px] scroll-mt-24 px-3 [perspective:1800px] sm:mt-20 sm:px-5"
			>
				<TiltIn>
					<DemoGuard>
						<Bento i={2} className="p-5 sm:p-7">
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div>
									<BentoTitle>Your orbit</BentoTitle>
									<p className="mt-1 text-[13px] text-ink-2">
										Who writes to you, and how they reach you · last 30 days
									</p>
								</div>
								<DemoBadge />
							</div>
							<Orbit
								senders={senders}
								categories={categories}
								className="mt-5"
							/>
						</Bento>
					</DemoGuard>
				</TiltIn>
			</div>
		</section>
	);
}
