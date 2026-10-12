import { Lumen } from "@/components/motion-garden/lumen";

const COPY =
	"Most email clients hand you everything and wish you luck. Raven reads the last thirty days first, then tells you who’s waiting, who owes you, and what can wait. You open what matters. The rest stays quiet.";

export function Manifesto() {
	return (
		<section aria-label="Why raven" className="mx-auto max-w-[1020px] px-5 py-20 sm:py-28">
			<Lumen
				text={COPY}
				className="text-center font-display text-[clamp(1.75rem,3.7vw,3.1rem)] leading-[1.16] tracking-[-0.025em]"
				dimOpacity={0.14}
				startOffset={0.12}
				endOffset={0.55}
			/>
		</section>
	);
}
