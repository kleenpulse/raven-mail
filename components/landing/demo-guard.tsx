"use client";

import type * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Demo widgets keep their real links into Mail; on the landing those threads
 * don't exist, so a click explains that instead of bouncing to sign-in.
 * `data-nosnippet` keeps the demo mailbox's names and counts out of search snippets.
 */
export function DemoGuard({ className, children }: { className?: string; children: React.ReactNode }) {
	const router = useRouter();

	function onClickCapture(e: React.MouseEvent) {
		const link = (e.target as Element).closest("a[href]");
		if (!link?.getAttribute("href")?.startsWith("/mail")) return;
		// Next's <Link> skips navigation when the default is already prevented.
		e.preventDefault();
		toast("That thread lives in the demo mailbox", {
			id: "demo-link",
			description: "Connect your own to open real mail.",
			action: { label: "Connect", onClick: () => router.push("/login") },
		});
	}

	return (
		<div className={className} onClickCapture={onClickCapture} data-nosnippet>
			{children}
		</div>
	);
}

export function DemoBadge({ className }: { className?: string }) {
	return (
		<span className={cn("readout inline-flex h-7 shrink-0 items-center gap-1.5 rounded-pill px-2.5 ring-1 ring-glass-border", className)}>
			<span aria-hidden className="size-1.5 rounded-full bg-signal-2 shadow-[0_0_8px_var(--signal-2)]" />
			Demo mailbox
		</span>
	);
}
