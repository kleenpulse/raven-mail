"use client";

import Link from "next/link";
import { RotateCw } from "lucide-react";
import { RavenMark } from "@/components/shell/raven-mark";
import { Button } from "@/components/ui/button";

/**
 * Catches crashes in the app shell (nav rail, account menu) and any page
 * without its own boundary — in the app's skin rather than Next's bare
 * built-in page, which drops our styles.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
	return (
		<main role="alert" className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-6 bg-background px-6 text-center">
			<RavenMark />
			<div className="space-y-2">
				<p className="readout">{error.digest ? `error · ref ${error.digest}` : "error · something broke"}</p>
				<h1 className="font-display text-[28px] leading-tight tracking-[-0.02em] text-foreground">
					This page couldn’t load
				</h1>
				<p className="mx-auto max-w-sm text-[14px] leading-relaxed text-ink-2">
					Something went wrong while drawing it. Try again, or head back to Overview.
				</p>
			</div>
			<div className="flex flex-wrap items-center justify-center gap-2">
				<Button size="pill" onClick={() => retry()}>
					<RotateCw />
					Try again
				</Button>
				<Link
					href="/overview"
					className="inline-flex h-10 items-center rounded-pill px-5 text-sm text-foreground ring-1 ring-border outline-none transition-colors hover:bg-card focus-visible:ring-2 focus-visible:ring-ring dark:ring-glass-border"
				>
					Back to Overview
				</Link>
			</div>
		</main>
	);
}
