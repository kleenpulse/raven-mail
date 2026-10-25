import { Coffee } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const SPONSOR_URL = "https://buymeacoffee.com/Vxrcel";

/** Shadow Garden's README support badge, built natively: icon-only below `sm`. */
export function SponsorButton({ className }: { className?: string }) {
	return (
		<Tip
			label="Buy me a coffee"
			render={
				<a
					href={SPONSOR_URL}
					target="_blank"
					rel="noopener noreferrer"
					aria-label="Support Raven: buy me a coffee"
					className={cn(
						"group/sponsor flex h-9 shrink-0 items-center overflow-hidden rounded-pill text-[12px] font-medium ring-1 ring-border outline-none transition-[box-shadow,transform] hover:ring-foreground/20 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] dark:ring-glass-border",
						className,
					)}
				/>
			}
		>
			<span className="hidden h-full items-center bg-card-nested px-3 text-ink-2 sm:flex">support</span>
			<span className="flex h-full items-center gap-1.5 bg-[#FFDD00] px-2.5 text-[#1a1400] sm:px-3">
				<Coffee aria-hidden className="size-4 transition-transform group-hover/sponsor:-rotate-12" />
				<span className="hidden sm:inline">buy me a coffee</span>
			</span>
		</Tip>
	);
}
