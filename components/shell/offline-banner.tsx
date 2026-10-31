"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useAppOffline } from "@/hooks/use-app-offline";
import { useComposeStore } from "@/lib/store/compose";
import { cn } from "@/lib/utils";

const BACK_MS = 2000;

/**
 * Says so while the app is offline, then "Back online" for a moment. UI only:
 * the reconnect itself is OnlineBridge's job in QueryProvider.
 */
export function OfflineBanner() {
	const offline = useAppOffline();
	const pill = useComposeStore((s) => s.open && s.minimized);
	const [back, setBack] = React.useState(false);
	const was = React.useRef(false);

	React.useEffect(() => {
		if (offline === was.current) return;
		was.current = offline;
		setBack(!offline);
		if (offline) return;
		const t = window.setTimeout(() => setBack(false), BACK_MS);
		return () => window.clearTimeout(t);
	}, [offline]);

	const state = offline ? "offline" : back ? "back" : null;

	return (
		<>
			<p role="status" className="sr-only">
				{state === "offline" ? "You're offline." : state === "back" ? "Back online." : ""}
			</p>
			{/* Bottom centre: the top holds the search field, the corners belong to the mail banners. */}
			<div
				className={cn(
					"pointer-events-none fixed inset-x-3 z-50 flex justify-center md:bottom-6 md:left-[84px]",
					// Above the phone tab bar, and above the compose pill when it's docked there.
					pill ? "bottom-[9.5rem]" : "bottom-[92px]",
				)}
			>
				<AnimatePresence>
					{state && (
						<motion.div
							key="offline"
							layout
							initial={{ opacity: 0, y: 10, scale: 0.98 }}
							animate={{ opacity: 1, y: 0, scale: 1 }}
							exit={{ opacity: 0, y: 8, transition: { duration: 0.16 } }}
							transition={{ type: "spring", stiffness: 420, damping: 34 }}
							className="pointer-events-auto flex items-center gap-2 rounded-pill bg-sheet px-3.5 py-1.5 text-[13px] text-foreground shadow-lift ring-1 ring-border dark:glass dark:ring-0"
						>
							<span
								aria-hidden
								className={cn("size-[7px] shrink-0 rounded-full", state === "offline" ? "bg-ink-3 motion-safe:animate-pulse" : "bg-ok")}
							/>
							{state === "offline" ? (
								<span>
									You&apos;re offline. <span className="text-ink-2">Mail you already loaded stays here.</span>
								</span>
							) : (
								<span>Back online</span>
							)}
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		</>
	);
}
