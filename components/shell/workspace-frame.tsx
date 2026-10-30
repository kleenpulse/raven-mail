"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";
import { NavRail, NAV_ITEMS, useNavBadges } from "@/components/shell/nav-rail";
import { ExportRunToast } from "@/components/integrations/export-toast";
import { NewMailBanner } from "@/components/mail/new-mail-banner";
import { FollowUpBanner } from "@/components/mail/follow-up-banner";
import { OfflineBanner } from "@/components/shell/offline-banner";
import { AccountMenu } from "@/components/shell/account-menu";
import { ComposeDock } from "@/components/mail/compose";
import { ReplaceComposeDialog } from "@/components/mail/replace-compose-dialog";
import { AskTray } from "@/components/jev/ask-tray";
import { useAskStore } from "@/components/jev/ask-store";
import { CommandPalette } from "@/components/shell/command-palette";
import { usePaletteStore } from "@/components/shell/palette-store";
import { useAskName } from "@/components/jev/ask-name";
import { useComposeStore } from "@/lib/store/compose";
import { allowSingleKey } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { TOUR_TARGET, tourAttr } from "@/components/tour/anchors";

function MobileTabBar({ onAsk }: { onAsk: () => void }) {
	const askName = useAskName();
	const pathname = usePathname();
	const badges = useNavBadges();
	const openCompose = useComposeStore((s) => s.openCompose);
	const item =
		"relative inline-flex size-11 items-center justify-center rounded-full text-ink-2 transition-colors [&_svg]:size-[18px]";

	return (
		<nav
			aria-label="Primary"
			className="glass fixed inset-x-3 bottom-3 z-30 flex h-16 items-center justify-around rounded-full px-2 shadow-lift md:hidden"
		>
			{NAV_ITEMS.map(({ href, label, icon: Icon, tour }) => {
				const active = pathname.startsWith(href);
				const badge = badges[href];
				return (
					<Link
						key={href}
						href={href}
						{...(tour && tourAttr(tour))}
						aria-current={active ? "page" : undefined}
						className={cn(item, active && "bg-inverse text-inverse-foreground dark:bg-signal-soft dark:text-signal")}
					>
						<Icon />
						<span className="sr-only">{label}</span>
						{badge && (
							<span
								aria-label={badge.label}
								className={cn(
									"absolute top-1 right-1 size-2 rounded-full",
									badge.kind === "dot" && badge.tone === "critical" ? "bg-critical" : "bg-signal",
								)}
							/>
						)}
					</Link>
				);
			})}
			<button
				type="button"
				onClick={() => openCompose("new")}
				{...tourAttr(TOUR_TARGET.compose)}
				className={cn(item, "size-12 bg-primary text-primary-foreground")}
			>
				<Plus />
				<span className="sr-only">Compose</span>
			</button>
			<button type="button" onClick={onAsk} className={cn(item, "text-signal-ink dark:text-signal")}>
				<Sparkles className="[&>path:first-child]:fill-current" />
				<span className="sr-only">Ask {askName}</span>
			</button>
			{/* Settings lives in this menu on phones. */}
			<AccountMenu side="top" className="size-10" tour={TOUR_TARGET.navSettings} />
		</nav>
	);
}

export function WorkspaceFrame({ children }: { children: React.ReactNode }) {
	const openCompose = useComposeStore((s) => s.openCompose);
	const openAsk = useAskStore((s) => s.requestFocus);
	const togglePalette = usePaletteStore((s) => s.toggle);
	const router = useRouter();

	const onKey = React.useEffectEvent((e: KeyboardEvent) => {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
			e.preventDefault();
			togglePalette();
			return;
		}
		if ((e.metaKey || e.ctrlKey) && e.key === ",") {
			e.preventDefault();
			router.push("/settings");
			return;
		}
		if (e.key === "c" && allowSingleKey(e)) {
			e.preventDefault();
			openCompose("new");
		}
	});

	React.useEffect(() => {
		const handler = (e: KeyboardEvent) => onKey(e);
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);

	// Interface Size zooms this frame; divide it back out so it still fits the viewport.
	return (
		<div data-ui-zoom className="relative flex h-[calc(100svh/var(--ui-zoom,1))] w-full overflow-hidden">
			<NavRail onAsk={openAsk} className="hidden md:flex" />
			<main className="relative min-w-0 flex-1 overflow-hidden pb-[88px] md:pb-0">{children}</main>
			<MobileTabBar onAsk={openAsk} />
			<React.Suspense fallback={null}>
				<AskTray />
			</React.Suspense>
			<ComposeDock />
			<ReplaceComposeDialog />
			<CommandPalette />
			<ExportRunToast />
			<NewMailBanner />
			<FollowUpBanner />
			<OfflineBanner />
		</div>
	);
}
