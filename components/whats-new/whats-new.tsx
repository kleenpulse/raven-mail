"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { releaseFor, type ChangeCategory, type ChangelogEntry, type ChangelogRelease } from "@/lib/changelog/parse";
import { APP_VERSION, readLastSeen, whatsNewAction, writeLastSeen } from "@/lib/changelog/seen";
import { cn } from "@/lib/utils";
import { useTourStore } from "@/components/tour/store";
import { closeChangelog, notifyChangelogHash, requestChangelogOpen, useChangelogOpen } from "./store";

// Mounted once in the (app) layout. Owns both dialogs: the one-shot What's New
// card (opens by itself after an upgrade) and the full changelog (opened from
// anywhere with requestChangelogOpen()). Also hands the releases to the
// Settings → About rows.

const CARD_MAX_ENTRIES = 5;

const CATEGORY_LABELS: Record<ChangeCategory, string> = {
	added: "New",
	changed: "Changed",
	fixed: "Fixed",
	removed: "Removed",
	deprecated: "Going away",
	security: "Security",
};

/** DialogFooter bleeds for p-4 content; these dialogs use p-5 and 24px corners. */
const FOOTER ="-mx-5 -mb-5 rounded-b-[24px] px-5";

const ReleasesContext = React.createContext<ChangelogRelease[]>([]);

/** Every released version, newest first. */
export function useReleases(): ChangelogRelease[] {
	return React.useContext(ReleasesContext);
}

/** Router navigations fire neither hashchange nor popstate. */
function HashNavSync() {
	const pathname = usePathname();
	React.useEffect(() => {
		notifyChangelogHash();
	}, [pathname]);
	return null;
}

function CategoryTag({ category }: { category: ChangeCategory }) {
	return (
		<span className="me-1.5 inline-block rounded-md bg-card-nested px-1.5 py-px align-[1px] font-mono text-[10px] tracking-wider text-ink-2 uppercase ring-1 ring-border dark:ring-glass-border">
			{CATEGORY_LABELS[category]}
		</span>
	);
}

export function EntryList({ entries, className }: { entries: ChangelogEntry[]; className?: string }) {
	return (
		<ul className={cn("flex flex-col gap-2.5", className)}>
			{entries.map((entry, i) => (
				<li key={i} className="text-[13px] leading-relaxed text-pretty text-ink-2">
					<CategoryTag category={entry.category} />
					{entry.text}
				</li>
			))}
		</ul>
	);
}

export function WhatsNew({ releases, children }: { releases: ChangelogRelease[]; children: React.ReactNode }) {
	const changelogOpen = useChangelogOpen();
	const [cardOpen, setCardOpen] = React.useState(false);
	const gotIt = React.useRef<HTMLButtonElement>(null);
	// The welcome tour holds the stage; the card waits until it ends.
	const tourActive = useTourStore().isActive;

	// Opening alone writes nothing — only a dismissal counts as seen, so a
	// reload before dismissing shows the card again.
	React.useEffect(() => {
		const action = whatsNewAction(readLastSeen(), APP_VERSION);
		if (action === "seed") writeLastSeen(APP_VERSION);
		// eslint-disable-next-line react-hooks/set-state-in-effect -- storage is only readable after mount
		else if (action === "show") setCardOpen(true);
	}, []);

	const dismiss = () => {
		setCardOpen(false);
		writeLastSeen(APP_VERSION);
	};

	const cardEntries = releaseFor(releases, APP_VERSION)?.entries.slice(0, CARD_MAX_ENTRIES) ?? [];

	return (
		<ReleasesContext value={releases}>
			{children}

			<Dialog open={cardOpen && !tourActive} onOpenChange={(next) => !next && dismiss()}>
				{/* Long entries in a short window scroll the list; the title and buttons stay in view. */}
				<DialogContent
					initialFocus={gotIt}
					className="max-h-[calc(100svh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] rounded-[24px] p-5 sm:max-w-md"
				>
					<DialogHeader>
						<DialogTitle>What&apos;s new</DialogTitle>
						<DialogDescription>Raven v{APP_VERSION}</DialogDescription>
					</DialogHeader>
					<div className="-mx-5 min-h-0 overflow-y-auto overscroll-contain px-5">
						{cardEntries.length > 0 ? (
							<EntryList entries={cardEntries} />
						) : (
							<p className="text-[13px] text-ink-2">Updated to v{APP_VERSION}.</p>
						)}
					</div>
					<DialogFooter className={FOOTER}>
						<Button
							variant="ghost"
							size="pill-sm"
							onClick={() => {
								dismiss();
								requestChangelogOpen();
							}}
						>
							Full changelog
						</Button>
						<Button ref={gotIt} variant="surface" size="pill-sm" onClick={dismiss}>
							Got it
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={changelogOpen} onOpenChange={(next) => !next && closeChangelog()}>
				<DialogContent className="rounded-[24px] p-5 sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>Changelog</DialogTitle>
						<DialogDescription>Every Raven release, newest first. You&apos;re on v{APP_VERSION}.</DialogDescription>
					</DialogHeader>
					<div className="-mx-5 max-h-[min(60svh,32rem)] overflow-y-auto overscroll-contain px-5 pb-2 mask-[linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)]">
						{releases.length === 0 ? (
							<p className="text-[13px] text-ink-2">No releases yet. History starts with the first one.</p>
						) : (
							<div className="flex flex-col gap-6 pb-6">
								{releases.map((rel) => (
									<section key={rel.version} className="flex flex-col gap-2.5">
										<h3 className="flex items-baseline gap-2 text-[14px] font-medium text-foreground">
											v{rel.version}
											{rel.date && <span className="readout">{rel.date}</span>}
										</h3>
										<EntryList entries={rel.entries} />
									</section>
								))}
							</div>
						)}
					</div>
				</DialogContent>
			</Dialog>

			<HashNavSync />
		</ReleasesContext>
	);
}
