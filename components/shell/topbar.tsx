"use client";

import * as React from "react";
import { Menu, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { allowSingleKey } from "@/lib/keyboard";
import { TOUR_TARGET, tourAttr } from "@/components/tour/anchors";
import { SponsorButton } from "@/components/shell/sponsor-button";

/** Mail-only toolbar: folder drawer + folder search. Account/theme live in the rail. */
export function Topbar({
	search,
	onSearchChange,
	onOpenSidebar,
}: {
	search: string;
	onSearchChange: (value: string) => void;
	onOpenSidebar: () => void;
}) {
	const inputRef = React.useRef<HTMLInputElement>(null);

	React.useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === "/" && allowSingleKey(e)) {
				e.preventDefault();
				inputRef.current?.focus();
			}
			if (e.key === "Escape" && document.activeElement === inputRef.current) {
				onSearchChange("");
				inputRef.current?.blur();
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onSearchChange]);

	return (
		<header className="flex h-16 shrink-0 items-center gap-2 px-3 md:px-4">
			<Button
				variant="surface"
				size="circle"
				className="lg:hidden"
				onClick={onOpenSidebar}
				aria-label="Open folders"
			>
				<Menu />
			</Button>

			<div {...tourAttr(TOUR_TARGET.search)} className="relative max-w-xl min-w-0 flex-1">
				<Search
					aria-hidden
					className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-2"
				/>
				<Input
					ref={inputRef}
					value={search}
					onChange={(e) => onSearchChange(e.target.value)}
					placeholder="Search this folder…"
					className="h-11 rounded-pill border-0 bg-sheet pr-12 pl-11 text-sm ring-1 ring-border hover:ring-foreground/20 focus-visible:ring-2 focus-visible:ring-ring dark:bg-card-nested dark:ring-glass-border dark:hover:ring-foreground/25 dark:focus-visible:ring-ring"
					aria-label="Search mail"
				/>
				{search ? (
					<button
						type="button"
						onClick={() => onSearchChange("")}
						className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-full text-ink-2 outline-none transition-colors hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-accent"
						aria-label="Clear search"
					>
						<X className="size-4" />
					</button>
				) : (
					<Kbd className="absolute top-1/2 right-4 hidden -translate-y-1/2 sm:inline-flex">/</Kbd>
				)}
			</div>

			<SponsorButton className="ml-auto" />
		</header>
	);
}
