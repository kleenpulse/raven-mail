import { ImageOff, KeyRound, Send, Server } from "lucide-react";
import { Reveal } from "@/components/motion-garden/reveal";
import { RavenMark } from "@/components/shell/raven-mark";
import { SectionHeading } from "@/components/landing/section-heading";

const POINTS = [
	{
		icon: KeyRound,
		title: "No password database",
		body: "Your mailbox password is sealed with AES-256-GCM into an http-only cookie on your device. There’s no table of passwords to leak.",
	},
	{
		icon: ImageOff,
		title: "Trackers stay dark",
		body: "Remote images are blocked until you allow them, and every email renders in a sandboxed frame.",
	},
	{
		icon: Send,
		title: "Nothing leaves on its own",
		body: "Briefs reach Slack, Discord or a webhook only when you press send. Paid Jev calls run only when you ask.",
	},
	{
		icon: Server,
		title: "Yours to host",
		body: "Raven is self-hosted. Run your own copy on a server or Vercel project, and your mail never passes through anyone else’s.",
	},
];

export function Privacy() {
	return (
		<section id="privacy" aria-labelledby="privacy-title" className="relative scroll-mt-20 py-12 sm:py-24">
			<div className="mx-auto max-w-[1240px] px-5">
				{/* A seal, not a logo drop: the mark inside two hairline rings, lit from within. */}
				<div aria-hidden className="relative mx-auto mb-10 grid size-36 place-items-center">
					<span className="absolute inset-0 rounded-full bg-[radial-gradient(closest-side,rgb(230_194_122/0.16),transparent)]" />
					<span className="absolute inset-0 rounded-full ring-1 ring-glass-border" />
					<span className="absolute inset-5 rounded-full ring-1 ring-signal/25" />
					<RavenMark className="relative size-14 [&_svg]:size-7" />
				</div>
				<Reveal>
					<SectionHeading
						id="privacy-title"
						index="03"
						eyebrow="Private by design"
						center
						title={
							<>
								Your mail stays{" "}
								<br />
								<span className="text-ink-2">between you and your server.</span>
							</>
						}
					>
						Raven reads live from your mailbox over IMAP and keeps nothing it doesn’t need. What it does keep
						stays with you.
					</SectionHeading>
				</Reveal>

				<ul className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{POINTS.map(({ icon: Icon, title, body }, idx) => (
						<li key={title}>
							{/* lift lives inside: Reveal's inline transform would override its hover. */}
							<Reveal delay={idx * 0.07} className="h-full">
								<div className="bento lift h-full p-6">
									<span className="grid size-11 place-items-center rounded-full bg-signal-soft text-signal ring-1 ring-signal/25">
										<Icon className="size-[18px]" />
									</span>
									<h3 className="mt-6 font-display text-[19px] leading-snug tracking-[-0.01em]">{title}</h3>
									<p className="mt-2 text-[13px] leading-relaxed text-ink-2">{body}</p>
								</div>
							</Reveal>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}
