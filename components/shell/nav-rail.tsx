"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useStore } from "zustand";
import { Blocks, FlaskConical, Inbox, LayoutGrid, Plus, Settings, Sparkles, type LucideIcon } from "lucide-react";
import { Tip, TooltipGroup } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { RavenMark } from "@/components/shell/raven-mark";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { AccountMenu } from "@/components/shell/account-menu";
import { useFolders } from "@/hooks/use-mail";
import { needsAttention, useCachedIntegrations } from "@/hooks/use-integrations";
import { useExportRun } from "@/lib/store/export-run";
import { useComposeStore } from "@/lib/store/compose";
import { cn, modKeyLabel } from "@/lib/utils";
import { TAB_SPRING } from "@/lib/motion";
import { TOUR_TARGET, tourAttr, type TourTargetId } from "@/components/tour/anchors";

export type NavItem = { href: string; label: string; icon: LucideIcon; tour?: TourTargetId };

export const NAV_ITEMS: NavItem[] = [
	{ href: "/overview", label: "Overview", icon: LayoutGrid },
	{ href: "/mail", label: "Mail", icon: Inbox, tour: TOUR_TARGET.navMail },
	{ href: "/integrations", label: "Integrations", icon: Blocks, tour: TOUR_TARGET.navIntegrations },
	// NODE_ENV is inlined into server and client bundles alike, so this can't mismatch on hydration.
	...(process.env.NODE_ENV === "production" ? [] : [{ href: "/dev/tests", label: "Tests", icon: FlaskConical }]),
];

export function useInboxUnread(): number {
	const { data } = useFolders();
	return data?.find((f) => f.specialUse === "\\Inbox" || f.path.toUpperCase() === "INBOX")?.unread ?? 0;
}

export type NavBadge =
	| { kind: "count"; value: number; label: string }
	| { kind: "dot"; tone: "critical" | "signal"; label: string };

/**
 * Badges for every destination, computed once (no hooks inside loops).
 * Integrations reads only what's already cached, so it never wakes the DB.
 */
export function useNavBadges(): Partial<Record<string, NavBadge>> {
	const unread = useInboxUnread();
	const integrations = useCachedIntegrations();
	const exportPhase = useStore(useExportRun, (s) => s.phase);
	const flagged = integrations?.connections?.filter(needsAttention).length ?? 0;
	const badges: Partial<Record<string, NavBadge>> = {};
	if (unread > 0) badges["/mail"] = { kind: "count", value: unread, label: `${unread} unread` };
	if (flagged > 0) {
		badges["/integrations"] = {
			kind: "dot",
			tone: "critical",
			label: `${flagged} ${flagged === 1 ? "integration needs" : "integrations need"} attention`,
		};
	} else if (exportPhase === "paused") {
		badges["/integrations"] = { kind: "dot", tone: "critical", label: "Export paused" };
	} else if (exportPhase === "planning" || exportPhase === "running" || exportPhase === "saving") {
		badges["/integrations"] = { kind: "dot", tone: "signal", label: "Export in progress" };
	}
	return badges;
}

const circle =
	"relative inline-flex size-11 items-center justify-center rounded-full outline-none transition-[background-color,color,box-shadow,transform] duration-200 focus-visible:ring-2 focus-visible:ring-ring active:scale-95 [&_svg]:size-[18px]";

function RailTip({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactElement }) {
	return (
		<Tip
			label={
				<>
					{label}
					{hint}
				</>
			}
			render={children}
		/>
	);
}

export function NavRail({ onAsk, className }: { onAsk: () => void; className?: string }) {
	const pathname = usePathname();
	const badges = useNavBadges();
	const openCompose = useComposeStore((s) => s.openCompose);
	const indicatorId = React.useId();
	const settingsActive = pathname.startsWith("/settings");
	const mod = React.useSyncExternalStore(
		() => () => {},
		() => modKeyLabel(),
		() => "Ctrl",
	);

	return (
		<nav
			aria-label="Primary"
			className={cn(
				"relative z-10 flex w-[84px] shrink-0 flex-col items-center gap-4 bg-band py-5",
				"dark:border-r dark:border-glass-border",
				className,
			)}
		>
			<TooltipGroup side="right" sideOffset={12}>
				<Link href="/overview" aria-label="Raven home" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
					<RavenMark />
				</Link>

				<div className="mt-2 flex flex-col gap-1.5 rounded-full bg-sheet p-1.5 ring-1 ring-border dark:bg-card-nested dark:ring-glass-border">
					{NAV_ITEMS.map((item) => {
						const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
						const Icon = item.icon;
						const badge = badges[item.href];
						return (
							<RailTip key={item.href} label={badge?.kind === "dot" ? `${item.label} · ${badge.label}` : item.label}>
								<Link
									href={item.href}
									{...(item.tour && tourAttr(item.tour))}
									aria-current={active ? "page" : undefined}
									className={cn(
										circle,
										"isolate",
										active
											? "text-inverse-foreground dark:text-signal"
											: "text-ink-2 hover:bg-card hover:text-foreground dark:hover:bg-accent",
									)}
								>
									{active && (
										<motion.span
											layoutId={indicatorId}
											aria-hidden
											transition={TAB_SPRING}
											className="absolute inset-0 -z-10 rounded-full bg-inverse dark:bg-signal-soft dark:shadow-glow"
										/>
									)}
									<Icon />
									<span className="sr-only">{item.label}</span>
									{badge?.kind === "count" && (
										<span
											aria-label={badge.label}
											className="tabular absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground ring-2 ring-sheet dark:ring-background"
										>
											{badge.value > 99 ? "99+" : badge.value}
										</span>
									)}
									{badge?.kind === "dot" && (
										<span
											aria-label={badge.label}
											className={cn(
												"absolute top-0.5 right-0.5 size-2.5 rounded-full ring-2 ring-sheet dark:ring-background",
												badge.tone === "critical" ? "bg-critical" : "animate-pulse bg-signal",
											)}
										/>
									)}
								</Link>
							</RailTip>
						);
					})}
				</div>

				<RailTip label="Compose" hint={<Kbd>C</Kbd>}>
					<button
						type="button"
						onClick={() => openCompose("new")}
						{...tourAttr(TOUR_TARGET.compose)}
						className={cn(circle, "bg-sheet text-foreground ring-1 ring-border hover:bg-card dark:bg-card-nested dark:ring-glass-border dark:hover:bg-accent")}
					>
						<Plus />
						<span className="sr-only">Compose</span>
					</button>
				</RailTip>

				<RailTip label="Ask Jev" hint={<Kbd>{mod}+K</Kbd>}>
					<button
						type="button"
						onClick={onAsk}
						className={cn(
							circle,
							"bg-signal-soft text-signal-ink hover:shadow-glow",
							"dark:text-signal dark:ring-1 dark:ring-signal/40",
						)}
					>
						<Sparkles className="[&>path:first-child]:fill-current" />
						<span className="sr-only">Ask Jev</span>
					</button>
				</RailTip>

				<div className="mt-auto flex flex-col items-center gap-3">
					<RailTip label="Settings" hint={<Kbd>{mod}+,</Kbd>}>
						<Link
							href="/settings"
							{...tourAttr(TOUR_TARGET.navSettings)}
							aria-current={settingsActive ? "page" : undefined}
							className={cn(
								circle,
								settingsActive
									? "bg-inverse text-inverse-foreground dark:bg-signal-soft dark:text-signal"
									: "text-ink-2 hover:bg-card hover:text-foreground dark:hover:bg-accent",
							)}
						>
							<Settings />
							<span className="sr-only">Settings</span>
						</Link>
					</RailTip>
					<ThemeToggle className={cn(circle, "text-ink-2 hover:text-foreground")} />
					<AccountMenu />
				</div>
			</TooltipGroup>
		</nav>
	);
}
