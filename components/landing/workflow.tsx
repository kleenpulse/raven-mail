import { Reveal } from "@/components/motion-garden/reveal";
import { BrandTile } from "@/components/integrations/brand-marks";
import { RAVEN_GLYPH, RavenMark } from "@/components/shell/raven-mark";
import { SectionHeading } from "@/components/landing/section-heading";
import { Kbd } from "@/components/ui/kbd";

const KEY = "h-7 min-w-7 rounded-md bg-card-nested px-2 font-mono text-[12px] text-foreground ring-1 ring-glass-border";

const SHORTCUTS = [
	{ keys: ["J", "K"], label: "Move through mail" },
	{ keys: ["C"], label: "Compose" },
	{ keys: ["/"], label: "Search" },
	{ keys: ["⌘", "K"], label: "Ask Jev" },
	{ keys: ["Esc"], label: "Back out" },
];

export function Workflow() {
	return (
		<section id="workflow" aria-labelledby="workflow-title" className="scroll-mt-20 py-12 sm:py-24">
			<div className="mx-auto max-w-[1240px] px-5">
				<Reveal>
					<SectionHeading
						id="workflow-title"
						index="04"
						eyebrow="And the rest"
						title={
							<>
								Built for the way{" "}
								<br />
								<span className="text-ink-2">you already work.</span>
							</>
						}
					/>
				</Reveal>

				<div className="mt-14 grid grid-cols-1 gap-4 lg:grid-cols-3">
					<Reveal className="h-full">
						<article className="bento flex h-full flex-col p-6">
							<div className="flex items-center gap-2">
								<BrandTile id="slack" />
								<BrandTile id="discord" />
								<BrandTile id="webhook" />
								<BrandTile id="export" />
							</div>
							<h3 className="mt-auto pt-8 font-display text-[21px] leading-snug tracking-[-0.01em]">
								Send the brief where you work
							</h3>
							<p className="mt-2 text-[13px] leading-relaxed text-ink-2">
								Share a thread or the daily brief to Slack, Discord, or a signed webhook for Zapier, Make and
								n8n. Take everything with you as a resumable .mbox export.
							</p>
						</article>
					</Reveal>

					<Reveal delay={0.07} className="h-full">
						<article className="bento flex h-full flex-col p-6">
							<ul className="grid gap-2.5">
								{SHORTCUTS.map((s) => (
									<li key={s.label} className="flex items-center justify-between gap-4 text-[13px] text-ink-2">
										{s.label}
										<span className="flex gap-1">
											{s.keys.map((k) => (
												<Kbd key={k} className={KEY}>
													{k}
												</Kbd>
											))}
										</span>
									</li>
								))}
							</ul>
							<h3 className="mt-auto pt-8 font-display text-[21px] leading-snug tracking-[-0.01em]">Hands stay on the keys</h3>
							<p className="mt-2 text-[13px] leading-relaxed text-ink-2">
								Triage, reply and ask without reaching for the mouse. A three-pane reader that never reloads.
							</p>
						</article>
					</Reveal>

					<Reveal delay={0.14} className="h-full">
						<article className="bento flex h-full flex-col p-6">
							<div className="grid h-[132px] grid-cols-2 overflow-hidden rounded-[20px] ring-1 ring-glass-border">
								<div className="relative grid place-items-center bg-[#f3f3f1]">
									<span className="grid size-12 place-items-center rounded-full bg-[#111] text-white">
										<Swatch eye="#e8603c" />
									</span>
									<span className="absolute bottom-2.5 left-3 font-mono text-[10px] tracking-[0.12em] text-[#6b6b6b]">EMBER</span>
								</div>
								<div className="relative grid place-items-center bg-[radial-gradient(120%_90%_at_70%_0%,#1e423c,#050a0b_70%)]">
									<RavenMark className="size-12" />
									<span className="absolute bottom-2.5 left-3 font-mono text-[10px] tracking-[0.12em] text-ink-2">NEBULA</span>
								</div>
							</div>
							<h3 className="mt-auto pt-8 font-display text-[21px] leading-snug tracking-[-0.01em]">
								Ember by day. Nebula by night.
							</h3>
							<p className="mt-2 text-[13px] leading-relaxed text-ink-2">
								A warm paper skin and a deep-space one. Switch with a tap, or let your system decide.
							</p>
						</article>
					</Reveal>
				</div>
			</div>
		</section>
	);
}

/** The raven glyph with Ember's coral eye — the Nebula mark can't render its light skin inside a dark page. */
function Swatch({ eye }: { eye: string }) {
	return (
		<svg viewBox="0 0 24 24" className="size-6" fill="none" aria-hidden>
			<path
				d={RAVEN_GLYPH}
				stroke="currentColor"
				strokeWidth="1.9"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<circle cx="15.4" cy="9.1" r="1.25" fill={eye} />
		</svg>
	);
}
