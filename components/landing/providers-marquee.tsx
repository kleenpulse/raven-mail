import { MarqueeVelocity } from "@/components/motion-garden/marquee-velocity";
import { PROVIDERS } from "@/lib/providers";

const NAMES = PROVIDERS.map((p) => (p.id === "custom" ? "Any IMAP / SMTP" : p.label));

/** Provider strip: drifts on its own, whips along with the scroll. */
export function ProvidersMarquee() {
	return (
		<section aria-labelledby="works-with" className="py-16 sm:py-20">
			<h2 id="works-with" className="readout text-center">
				Works with the mailbox you already have
			</h2>
			<ul className="sr-only">
				{NAMES.map((name) => (
					<li key={name}>{name}</li>
				))}
			</ul>
			<div aria-hidden>
				<MarqueeVelocity
					velocity={-36}
					containerClassName="mt-7 mask-[linear-gradient(90deg,transparent,black_14%,black_86%,transparent)]"
					className="font-display text-[clamp(1.75rem,3.6vw,2.9rem)] tracking-[-0.025em] text-ink-2"
				>
					{NAMES.map((name) => (
						<span key={name} className="flex items-center">
							{name}
							<span className="mx-9 size-1.5 rounded-full bg-signal/70 shadow-[0_0_10px_var(--signal)]" />
						</span>
					))}
				</MarqueeVelocity>
			</div>
		</section>
	);
}
