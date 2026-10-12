import { Reveal } from "@/components/motion-garden/reveal";
import { AskDemo } from "@/components/landing/ask-demo";
import { SectionHeading } from "@/components/landing/section-heading";
import { Kbd } from "@/components/ui/kbd";
import type { Overview } from "@/lib/insights/types";
import type { DemoAsk } from "@/lib/landing/demo";

const KEY = "bg-card-nested text-foreground ring-1 ring-glass-border";

const STEPS = [
	{ title: "Understand", body: "Works out what you mean: the intent, the time range, the person." },
	{ title: "Search", body: "Scans your mailbox. Counts and dates are computed in code, never guessed." },
	{ title: "Rank", body: "Orders what it found by what you asked — Jev with a TypeSafe key, a free keyword planner without." },
	{ title: "Answer", body: "Shows the emails behind it, how sure it is, and exactly what it searched." },
];

export function AskShowcase({ asks, overview }: { asks: DemoAsk[]; overview: Overview }) {
	return (
		<section id="ask" aria-labelledby="ask-title" className="relative scroll-mt-20 py-12 sm:py-24">
			<div className="mx-auto grid max-w-[1240px] grid-cols-1 items-start gap-12 px-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
				<div className="lg:sticky lg:top-28">
					<Reveal>
						<SectionHeading
							id="ask-title"
							index="02"
							eyebrow="Ask Jev"
							title={
								<>
									Ask your inbox.{" "}
									<br />
									<span className="text-ink-2">Get receipts.</span>
								</>
							}
						>
							Jev is a decision model, not a chatbot: it chooses and ranks, and never writes a word. Every
							answer is built from your own emails, shown right under it.
						</SectionHeading>
					</Reveal>

					<ol className="mt-10 divide-y divide-glass-border border-y border-glass-border">
						{STEPS.map((step, idx) => (
							<li key={step.title} className="grid grid-cols-[2.25rem_1fr] py-4">
								<span className="pt-0.5 font-mono text-[11px] text-signal tabular">0{idx + 1}</span>
								<div>
									<p className="text-[15px] font-medium">{step.title}</p>
									<p className="mt-1 text-[13px] leading-relaxed text-ink-2">{step.body}</p>
								</div>
							</li>
						))}
					</ol>
					<p className="mt-6 hidden flex-wrap lg:flex items-center gap-1.5 text-[13px] text-ink-2">
						Anywhere in Raven, press <Kbd className={KEY}>⌘</Kbd>
						<Kbd className={KEY}>K</Kbd> or <Kbd className={KEY}>Ctrl</Kbd>
						<Kbd className={KEY}>K</Kbd>.
					</p>
				</div>

				<Reveal y={24}>
					<AskDemo
						asks={asks}
						kpis={{
							unread: overview.kpis.unread,
							needsReply: overview.kpis.needsReply,
							waitingOn: overview.kpis.waitingOn,
							replyMin: overview.replyTimes.yours.medianMin,
						}}
					/>
				</Reveal>
			</div>
		</section>
	);
}
