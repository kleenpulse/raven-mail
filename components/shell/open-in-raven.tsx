"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { RavenMark } from "@/components/shell/raven-mark";
import { bounceTarget, webPath } from "@/lib/desktop/open-link";
import { SOURCE_URL } from "@/lib/site";

const primary =
	"inline-flex h-10 items-center gap-2 rounded-pill bg-primary px-5 text-sm font-medium text-primary-foreground outline-none transition-[box-shadow] hover:shadow-glow focus-visible:ring-2 focus-visible:ring-ring";
const secondary =
	"inline-flex h-10 items-center rounded-pill px-5 text-sm text-foreground ring-1 ring-border outline-none transition-colors hover:bg-card focus-visible:ring-2 focus-visible:ring-ring dark:ring-glass-border";

/** Tries the desktop app once on arrival, and keeps a button for when the browser asks first. */
export function OpenInRaven() {
	const target = bounceTarget(useSearchParams().get("to"));

	React.useEffect(() => {
		if (target) window.location.href = target;
	}, [target]);

	return (
		<>
			<Link href="/" aria-label="raven home" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
				<RavenMark />
			</Link>
			<div className="space-y-2">
				<p className="readout">raven desktop</p>
				<h1 className="font-display text-[28px] leading-tight tracking-[-0.02em] text-foreground">
					{target ? "Opening Raven" : "This link doesn't open Raven"}
				</h1>
				<p className="mx-auto max-w-sm text-[14px] leading-relaxed text-ink-2">
					{target
						? "If Raven didn't open, click the button below. It opens in the Raven desktop app on this computer."
						: "The link may be broken or cut short. Ask the person who shared it to send it again."}
				</p>
			</div>
			{target && (
				<div className="flex flex-wrap items-center justify-center gap-2">
					<a href={target} className={primary}>
						Open in Raven
						<ArrowRight className="size-4" />
					</a>
					<Link href={webPath(target)} className={secondary}>
						Open in the browser
					</Link>
				</div>
			)}
			<p className="text-[13px] text-ink-2">
				Don&apos;t have the desktop app?{" "}
				<a href={`${SOURCE_URL}#desktop`} className="text-foreground underline underline-offset-4 hover:text-signal-ink dark:hover:text-signal">
					Get Raven desktop
				</a>
			</p>
		</>
	);
}
