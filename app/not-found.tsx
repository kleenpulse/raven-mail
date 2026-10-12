import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { RavenMark } from "@/components/shell/raven-mark";

export const metadata: Metadata = { title: "Not found" };

/** Unmatched URLs and notFound() calls — in the app's skin rather than Next's bare default. */
export default function NotFound() {
	return (
		<main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-6 bg-background px-6 text-center">
			{/* Both buttons need a session; signed-out visitors get home through the mark. */}
			<Link
				href="/"
				aria-label="raven home"
				className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<RavenMark />
			</Link>
			<div className="space-y-2">
				<p className="readout">404 · not found</p>
				<h1 className="font-display text-[28px] leading-tight tracking-[-0.02em] text-foreground">
					Nothing lives at this address
				</h1>
				<p className="mx-auto max-w-sm text-[14px] leading-relaxed text-ink-2">
					The link may be old, or the page moved. Your mail is where you left it.
				</p>
			</div>
			<div className="flex flex-wrap items-center justify-center gap-2">
				<Link
					href="/overview"
					className="inline-flex h-10 items-center gap-2 rounded-pill bg-primary px-5 text-sm font-medium text-primary-foreground outline-none transition-[box-shadow] hover:shadow-glow focus-visible:ring-2 focus-visible:ring-ring"
				>
					Back to Overview
					<ArrowRight className="size-4" />
				</Link>
				<Link
					href="/mail"
					className="inline-flex h-10 items-center rounded-pill px-5 text-sm text-foreground ring-1 ring-border outline-none transition-colors hover:bg-card focus-visible:ring-2 focus-visible:ring-ring dark:ring-glass-border"
				>
					Open Mail
				</Link>
			</div>
		</main>
	);
}
