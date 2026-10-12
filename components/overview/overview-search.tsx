"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { allowSingleKey } from "@/lib/keyboard";

/**
 * A real search field on Overview: type, Enter → Mail opens on the Inbox with the
 * query applied (Mail keeps it in `?q=`). `/` focuses it, Esc clears.
 */
export function OverviewSearch() {
	const router = useRouter();
	const inputRef = React.useRef<HTMLInputElement>(null);
	const [value, setValue] = React.useState("");

	React.useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === "/" && allowSingleKey(e)) {
				e.preventDefault();
				inputRef.current?.focus();
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	function submit(e: React.FormEvent) {
		e.preventDefault();
		const q = value.trim();
		router.push(q ? `/mail?${new URLSearchParams({ q })}` : "/mail");
	}

	return (
		<form role="search" onSubmit={submit} className="relative hidden w-72 lg:block">
			<Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-2" />
			<input
				ref={inputRef}
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						setValue("");
						e.currentTarget.blur();
					}
				}}
				placeholder="Search mail…"
				aria-label="Search mail"
				autoComplete="off"
				maxLength={200}
				className="h-11 w-full rounded-pill bg-sheet pr-12 pl-11 text-sm text-foreground ring-1 ring-border outline-none transition-shadow placeholder:text-ink-2 hover:ring-foreground/20 focus-visible:ring-2 focus-visible:ring-ring dark:bg-card-nested dark:ring-glass-border"
			/>
			<Kbd className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2">
				{value ? <CornerDownLeft className="size-3" aria-label="Enter" /> : "/"}
			</Kbd>
		</form>
	);
}
