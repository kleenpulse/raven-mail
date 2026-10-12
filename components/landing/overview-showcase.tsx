import { Reveal } from "@/components/motion-garden/reveal";
import { DemoBoard } from "@/components/landing/demo-board";
import { SectionHeading } from "@/components/landing/section-heading";
import { TiltIn } from "@/components/landing/tilt-in";
import type { Overview } from "@/lib/insights/types";

const NOTES = [
	{
		title: "Needs reply, per person",
		body: "Judged against how fast each person usually hears back from you, not a blanket timer.",
	},
	{
		title: "Reply debt, with a payoff",
		body: "Hours owed across open threads, and the three replies that pay down the most.",
	},
	{
		title: "Inbox weather",
		body: "Today’s load against your usual for this weekday, with the heavy front forecast.",
	},
	{
		title: "Daily brief",
		body: "Today’s handful of threads worth opening first, each with the reason it made the cut.",
	},
];

export function OverviewShowcase({ overview }: { overview: Overview }) {
	return (
		<section
			id="overview"
			aria-labelledby="overview-title"
			className="relative scroll-mt-20 overflow-x-clip py-12 sm:py-24"
		>
			<div className="mx-auto max-w-[1240px] px-5">
				<Reveal>
					<SectionHeading
						id="overview-title"
						index="01"
						eyebrow="Overview"
						title={
							<>
								One sheet. <br />
								<span className="text-ink-2 max-sm:text-2xl">
									Everything that needs you.
								</span>
							</>
						}
					>
						Open Raven and the answer to “what needs me?” is already on the page
						— computed from a live thirty-day window of your own mailbox. Try
						the cards; they work.
					</SectionHeading>
				</Reveal>
			</div>

			<div className="mx-auto mt-14 max-w-[1480px] px-3 [perspective:2200px] sm:px-4">
				<TiltIn tilt={12}>
					<DemoBoard overview={overview} />
				</TiltIn>
			</div>

			<dl className="mx-auto mt-12 grid max-w-[1240px] grid-cols-1 gap-x-8 gap-y-8 sm:mt-16 sm:gap-y-10 px-5 sm:grid-cols-2 lg:grid-cols-4">
				{NOTES.map((note, idx) => (
					<Reveal
						key={note.title}
						delay={idx * 0.06}
						className="border-t border-glass-border pt-5"
					>
						<dt className="flex items-baseline gap-3 text-[15px] font-medium">
							<span className="font-mono text-[11px] text-signal tabular">
								0{idx + 1}
							</span>
							{note.title}
						</dt>
						<dd className="mt-2 pl-7 text-[13px] leading-relaxed text-ink-2">
							{note.body}
						</dd>
					</Reveal>
				))}
			</dl>
		</section>
	);
}
