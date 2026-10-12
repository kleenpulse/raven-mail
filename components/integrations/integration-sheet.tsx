"use client";

import * as React from "react";
import { ExternalLink, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { BrandTile } from "@/components/integrations/brand-marks";
import { ChatPanel } from "@/components/integrations/chat-panel";
import { ExportPanel } from "@/components/integrations/export-panel";
import { JevPanel, MailPanel } from "@/components/integrations/health-panel";
import { SectionBoundary } from "@/components/integrations/section-boundary";
import { CHAT, catalogEntry } from "@/lib/integrations/catalog";
import type { CatalogId, IntegrationsOverview } from "@/lib/integrations/types";

const DESKTOP = "(min-width: 768px)";

function subscribeDesktop(onChange: () => void) {
	const mq = window.matchMedia(DESKTOP);
	mq.addEventListener("change", onChange);
	return () => mq.removeEventListener("change", onChange);
}

function Panel({ id, data, onRetry }: { id: CatalogId; data: IntegrationsOverview; onRetry: () => void }) {
	if (id === "mail") return <MailPanel data={data} />;
	if (id === "jev") return <JevPanel data={data} />;
	if (id === "export") return <ExportPanel dbReady={data.dbReady} />;
	const entry = CHAT.find((c) => c.id === id)!;
	return <ChatPanel entry={entry} data={data} onRetry={onRetry} />;
}

/**
 * One scrolling panel per integration, opened by `?i=` so it deep-links and
 * Back closes it. Right-hand sheet on desktop, bottom sheet on phones.
 */
export function IntegrationSheet({
	id,
	data,
	onClose,
	onRetry,
}: {
	id: CatalogId | null;
	data: IntegrationsOverview | undefined;
	onClose: () => void;
	onRetry: () => void;
}) {
	const desktop = React.useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP).matches, () => true);
	// Keep rendering the last panel while the sheet animates out.
	const [shown, setShown] = React.useState<CatalogId | null>(id);
	if (id && id !== shown) setShown(id);
	const entry = shown ? catalogEntry(shown) : null;
	// Land focus on the panel itself: screen readers start at the content, and no
	// stray focus ring lights up the first link in the header.
	const body = React.useRef<HTMLDivElement>(null);

	return (
		<Sheet open={Boolean(id && data)} onOpenChange={(open) => !open && onClose()}>
			<SheetContent
				side={desktop ? "right" : "bottom"}
				showCloseButton={false}
				initialFocus={body}
				className="gap-0 overflow-hidden bg-sheet p-0 text-foreground shadow-lift data-[side=bottom]:max-h-[92svh] data-[side=bottom]:rounded-t-frame data-[side=right]:w-full data-[side=right]:rounded-l-card data-[side=right]:sm:max-w-[560px] dark:glass"
			>
				{entry && data && shown && (
					<>
						<header className="flex items-start gap-4 border-b border-border px-6 pt-6 pb-5 dark:border-glass-border">
							<BrandTile id={shown} size="lg" />
							<div className="min-w-0 flex-1 pt-1">
								<SheetTitle className="font-display text-[20px] leading-tight tracking-[-0.01em]">{entry.name}</SheetTitle>
								<SheetDescription className="mt-1 text-[12px] text-ink-2">
									{shown === "mail" || shown === "jev" ? "Built in" : shown === "export" ? "Data" : "Chat & automation"}
									{entry.docsUrl && (
										<>
											{" · "}
											<a href={entry.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-signal-ink underline-offset-2 hover:underline dark:text-signal">
												Docs <ExternalLink className="size-3" />
											</a>
										</>
									)}
								</SheetDescription>
							</div>
							<SheetClose
								aria-label="Close"
								className="grid size-9 shrink-0 place-items-center rounded-full text-ink-2 ring-1 ring-border outline-none hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:ring-glass-border dark:hover:bg-accent"
							>
								<X className="size-4" />
							</SheetClose>
						</header>
						<div ref={body} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-10 outline-none scrollbar-thin">
							<SectionBoundary title={entry.name}>
								<Panel id={shown} data={data} onRetry={onRetry} />
							</SectionBoundary>
						</div>
					</>
				)}
			</SheetContent>
		</Sheet>
	);
}
