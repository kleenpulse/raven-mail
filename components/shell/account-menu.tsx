"use client";

import Link from "next/link";
import { Compass, LogOut, Settings, Sparkles } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAccount } from "@/components/providers/account-provider";
import { requestChangelogOpen } from "@/components/whats-new/store";
import { useSignOut } from "@/hooks/use-sign-out";
import { tourAttr, type TourTargetId } from "@/components/tour/anchors";
import { requestTourResume, requestTourRestart } from "@/components/tour/store";
import { useTourStateStore } from "@/lib/tour/state";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function AccountMenu({
	side = "right",
	className,
	tour,
}: {
	side?: "right" | "top";
	className?: string;
	/** Tour anchor for the trigger (phones: Settings lives in this menu). */
	tour?: TourTargetId;
}) {
	const account = useAccount();
	const signOut = useSignOut();
	const tourSkipped = useTourStateStore((s) => s.tour.skipped);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label="Account menu"
				{...(tour && tourAttr(tour))}
				className={cn(
					"inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-card-nested font-display text-sm font-semibold text-foreground ring-1 ring-border outline-none transition-colors hover:bg-card focus-visible:ring-2 focus-visible:ring-ring",
					"dark:bg-signal-soft dark:text-signal dark:ring-glass-border",
					className,
				)}
			>
				{initials(account.displayName, account.email)}
			</DropdownMenuTrigger>
			<DropdownMenuContent
				side={side}
				align="end"
				sideOffset={10}
				className="w-64 p-1.5"
			>
				{/* Base UI's GroupLabel throws outside a Group; the group also names the menu for screen readers. */}
				<DropdownMenuGroup>
					<DropdownMenuLabel className="normal-case">
						<div className="truncate text-sm font-medium text-foreground">
							{account.displayName}
						</div>
						<div className="truncate text-xs font-normal text-muted-foreground">
							{account.email}
						</div>
						<div className="readout mt-1.5">{account.provider}</div>
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem render={<Link href="/settings" />}>
						<Settings className="size-4" />
						Settings
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => requestChangelogOpen()}>
						<Sparkles className="size-4" />
						What&apos;s new
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() =>
							tourSkipped ? requestTourResume() : requestTourRestart()
						}
					>
						<Compass className="size-4" />
						{tourSkipped ? "Resume the tour" : "Take the tour"}
					</DropdownMenuItem>
					<DropdownMenuItem
						variant="destructive"
						onClick={() => void signOut()}
					>
						<LogOut className="size-4" />
						Sign out
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
