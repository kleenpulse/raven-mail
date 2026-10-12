"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { motion } from "motion/react";
import {
	Bell,
	ChevronLeft,
	ChevronRight,
	Compass,
	Info,
	Inbox,
	Keyboard,
	Palette,
	RefreshCw,
	Search,
	UserRound,
	X,
	type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import {
	searchSettings,
	SECTION_IDS,
	SECTIONS,
	sectionPrefs,
	type SectionId,
	type SettingEntry,
} from "@/components/settings";
import { SectionBody, SettingRows } from "@/components/settings/sections";
import { resetWithUndo, SettingsCard, SettingsQuery, useAnyModified } from "@/components/settings/setting-row";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { allowSingleKey } from "@/lib/keyboard";
import { TAB_SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

const ICONS: Record<SectionId, LucideIcon> = {
	appearance: Palette,
	mail: Inbox,
	notifications: Bell,
	sync: RefreshCw,
	keyboard: Keyboard,
	tour: Compass,
	account: UserRound,
	about: Info,
};

const GROUPS = ["Preferences", "You"] as const;

const parseSection = parseAsStringLiteral(SECTION_IDS);

/** `?s=` holds the section: deep links and Back work, and switching never waits on the server. */
function useSection() {
	const router = useRouter();
	const [raw, setRaw] = useQueryState("s", parseSection);
	const pushed = React.useRef(false);

	React.useEffect(() => {
		if (!raw) pushed.current = false;
	}, [raw]);

	const open = React.useCallback(
		(id: SectionId) => {
			pushed.current = true;
			void setRaw(id, { history: "push", scroll: false });
		},
		[setRaw],
	);
	/** Phones: back to the section list, popping our own history entry when there is one. */
	const close = React.useCallback(() => {
		if (pushed.current) {
			pushed.current = false;
			router.back();
		} else {
			void setRaw(null, { history: "replace", scroll: false });
		}
	}, [router, setRaw]);

	return { raw, open, close };
}

function RailItem({
	id,
	selected,
	indicatorId,
	onSelect,
}: {
	id: SectionId;
	selected: boolean;
	indicatorId: string;
	onSelect: (id: SectionId) => void;
}) {
	const Icon = ICONS[id];
	const modified = useAnyModified(sectionPrefs(id));
	return (
		<button
			type="button"
			role="tab"
			id={`settings-tab-${id}`}
			aria-selected={selected}
			aria-controls="settings-panel"
			tabIndex={selected ? 0 : -1}
			onClick={() => onSelect(id)}
			className={cn(
				"relative isolate flex h-10 w-full items-center gap-3 rounded-pill px-3.5 text-left text-[13.5px] outline-none transition-[color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]",
				selected ? "font-medium text-inverse-foreground dark:text-signal" : "text-ink-2 hover:text-foreground",
			)}
		>
			{selected && (
				<motion.span
					layoutId={indicatorId}
					aria-hidden
					transition={TAB_SPRING}
					className="absolute inset-0 -z-10 rounded-pill bg-inverse dark:bg-signal-soft"
				/>
			)}
			<Icon aria-hidden className="size-4 shrink-0" />
			<span className="min-w-0 flex-1 truncate">{SECTIONS[id].label}</span>
			{modified && (
				<span
					aria-label="Has changes"
					className={cn("size-1.5 shrink-0 rounded-full", selected ? "bg-inverse-foreground dark:bg-signal" : "bg-signal")}
				/>
			)}
		</button>
	);
}

function Rail({
	section,
	onSelect,
	onKeySelect,
}: {
	section: SectionId;
	onSelect: (id: SectionId) => void;
	onKeySelect: (id: SectionId) => void;
}) {
	const indicatorId = React.useId();

	function onKeyDown(e: React.KeyboardEvent) {
		const i = SECTION_IDS.indexOf(section);
		const last = SECTION_IDS.length - 1;
		const next =
			e.key === "ArrowDown"
				? i === last ? 0 : i + 1
				: e.key === "ArrowUp"
					? i === 0 ? last : i - 1
					: e.key === "Home"
						? 0
						: e.key === "End"
							? last
							: -1;
		if (next < 0) return;
		e.preventDefault();
		const id = SECTION_IDS[next]!;
		onKeySelect(id);
		document.getElementById(`settings-tab-${id}`)?.focus();
	}

	return (
		<div role="tablist" aria-orientation="vertical" aria-label="Settings sections" onKeyDown={onKeyDown} className="space-y-5">
			{GROUPS.map((group) => (
				<div key={group} role="presentation">
					<p className="readout mb-1.5 px-3.5" role="presentation">
						{group}
					</p>
					<div className="space-y-0.5" role="presentation">
						{SECTION_IDS.filter((id) => SECTIONS[id].group === group).map((id) => (
							<RailItem key={id} id={id} selected={id === section} indicatorId={indicatorId} onSelect={onSelect} />
						))}
					</div>
				</div>
			))}
		</div>
	);
}

/** Phones: the iOS-style list you drill into. */
function SectionList({ onOpen }: { onOpen: (id: SectionId) => void }) {
	return (
		<nav aria-label="Settings sections" className="space-y-4 md:hidden">
			{GROUPS.map((group) => (
				<section key={group} className="bento overflow-hidden">
					<h2 className="readout px-5 pt-4 pb-1">{group}</h2>
					<ul className="divide-y divide-border/70 dark:divide-glass-border">
						{SECTION_IDS.filter((id) => SECTIONS[id].group === group).map((id) => {
							const Icon = ICONS[id];
							return (
								<li key={id}>
									<button
										type="button"
										onClick={() => onOpen(id)}
										className="flex min-h-14 w-full items-center gap-3.5 px-5 py-3 text-left outline-none transition-colors focus-visible:bg-card-nested active:bg-card-nested"
									>
										<span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-sheet ring-1 ring-border dark:bg-signal-soft dark:text-signal dark:ring-glass-border">
											<Icon aria-hidden className="size-4" />
										</span>
										<span className="min-w-0 flex-1">
											<span className="block text-[14.5px] font-medium">{SECTIONS[id].label}</span>
											<span className="block truncate text-[12.5px] text-ink-2">{SECTIONS[id].blurb}</span>
										</span>
										<ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />
									</button>
								</li>
							);
						})}
					</ul>
				</section>
			))}
		</nav>
	);
}

function SectionHeader({ section, onBack }: { section: SectionId; onBack: () => void }) {
	const prefs = sectionPrefs(section);
	const modified = useAnyModified(prefs);
	const { label, blurb } = SECTIONS[section];
	return (
		<div className="mb-5">
			<button
				type="button"
				onClick={onBack}
				className="-ml-2 mb-2 inline-flex h-10 items-center gap-1 rounded-pill pr-3 pl-1.5 text-[13px] text-ink-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:hidden"
			>
				<ChevronLeft aria-hidden className="size-4" />
				Settings
			</button>
			<div className="flex items-end justify-between gap-4">
				<div className="min-w-0">
					<h2 className="font-display text-[20px] leading-tight tracking-[-0.01em]">{label}</h2>
					<p className="mt-1 text-[13px] text-ink-2">{blurb}</p>
				</div>
				{modified && (
					<Button variant="ghost" size="pill-sm" onClick={() => resetWithUndo(prefs, `${label} reset to defaults`)}>
						Reset section
					</Button>
				)}
			</div>
		</div>
	);
}

function SearchResults({ results, query, onJump }: { results: SettingEntry[]; query: string; onJump: (entry: SettingEntry) => void }) {
	if (results.length === 0) {
		return (
			<div className="bento px-6 py-10 text-center">
				<p className="text-[14px] font-medium">No settings match “{query.trim()}”</p>
				<p className="mt-1 text-[13px] text-ink-2">Try another word, like “mail” or “motion”.</p>
			</div>
		);
	}
	const bySection = SECTION_IDS.map((id) => ({ id, entries: results.filter((r) => r.section === id) })).filter(
		(g) => g.entries.length > 0,
	);
	return (
		<div className="space-y-4" aria-live="polite">
			<p className="sr-only">
				{results.length} {results.length === 1 ? "setting" : "settings"} found
			</p>
			{bySection.map(({ id, entries }) => (
				<SettingsCard
					key={id}
					title={
						<button
							type="button"
							onClick={() => onJump(entries[0]!)}
							className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
						>
							{SECTIONS[id].label}
							<ChevronRight aria-hidden className="size-3" />
						</button>
					}
				>
					<SettingRows entries={entries} />
				</SettingsCard>
			))}
		</div>
	);
}

export function SettingsBoard() {
	const { raw, open, close } = useSection();
	const section: SectionId = raw ?? "appearance";
	const [query, setQuery] = React.useState("");
	const deferredQuery = React.useDeferredValue(query);
	const results = deferredQuery.trim() ? searchSettings(deferredQuery) : null;
	const searchRef = React.useRef<HTMLInputElement>(null);
	const scrollRef = React.useRef<HTMLDivElement>(null);
	const panelRef = React.useRef<HTMLDivElement>(null);
	const reduced = useReducedMotion();
	// Keyboard-driven section changes skip the entrance: the change should feel instant.
	const [animate, setAnimate] = React.useState(true);
	const [flashId, setFlashId] = React.useState<string | null>(null);

	const select = React.useCallback(
		(id: SectionId, viaKeyboard = false) => {
			setAnimate(!viaKeyboard);
			open(id);
		},
		[open],
	);

	const jump = React.useCallback(
		(entry: SettingEntry) => {
			setQuery("");
			setAnimate(false);
			open(entry.section);
			setFlashId(entry.id);
		},
		[open],
	);

	React.useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === "/" && allowSingleKey(e)) {
				e.preventDefault();
				searchRef.current?.focus();
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	// A new section starts at its top, unless the panel's top is already in view.
	React.useLayoutEffect(() => {
		const scroller = scrollRef.current;
		const panel = panelRef.current;
		if (!scroller || !panel || flashId) return;
		const offset = panel.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
		if (offset < 0) scroller.scrollTop += offset - 16;
	}, [section, flashId]);

	// Search → jump: bring the row into view and ring it briefly.
	React.useEffect(() => {
		if (!flashId || results) return;
		const el = document.getElementById(`setting-${flashId}`);
		if (!el) return;
		el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
		el.dataset.flash = "true";
		const t = window.setTimeout(() => {
			delete el.dataset.flash;
			setFlashId(null);
		}, 700);
		return () => window.clearTimeout(t);
	}, [flashId, results, section, reduced]);

	const listOnly = raw === null && !results;

	return (
		<div ref={scrollRef} className="h-full overflow-y-auto">
			<div className="mx-auto max-w-[1120px] px-5 pt-6 md:px-8">
				<header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
					<div className="min-w-0">
						<h1 className="font-display text-[22px] leading-tight tracking-[-0.01em]">Settings</h1>
						<p className="mt-0.5 text-[13px] text-ink-2">Changes save right away, on this device only.</p>
					</div>
					<div className="relative w-full sm:w-72">
						<Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-2" />
						<Input
							ref={searchRef}
							type="search"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Escape") {
									setQuery("");
									e.currentTarget.blur();
								} else if (e.key === "Enter") {
									const first = searchSettings(query)[0];
									if (first) jump(first);
								}
							}}
							placeholder="Search settings…"
							aria-label="Search settings"
							className="h-11 rounded-pill border-0 bg-sheet pr-12 pl-11 text-sm ring-1 ring-border hover:ring-foreground/20 focus-visible:ring-2 focus-visible:ring-ring dark:bg-card-nested dark:ring-glass-border dark:hover:ring-foreground/25 dark:focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
						/>
						{query ? (
							<button
								type="button"
								onClick={() => {
									setQuery("");
									searchRef.current?.focus();
								}}
								className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-full text-ink-2 outline-none transition-colors hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-accent"
								aria-label="Clear search"
							>
								<X className="size-4" />
							</button>
						) : (
							<Kbd className="absolute top-1/2 right-4 hidden -translate-y-1/2 sm:inline-flex">/</Kbd>
						)}
					</div>
				</header>
			</div>

			<div className="mt-6 min-h-[calc(100%-7rem)] rounded-t-frame bg-sheet pb-28 dark:border-t dark:border-glass-border">
				<div className="mx-auto flex max-w-[1120px] gap-10 px-5 py-6 md:px-8 md:py-8">
					<aside className="sticky top-8 hidden w-52 shrink-0 self-start md:block">
						<Rail section={section} onSelect={(id) => select(id)} onKeySelect={(id) => select(id, true)} />
					</aside>

					<div ref={panelRef} className="min-w-0 max-w-[680px] flex-1">
						<SettingsQuery.Provider value={results ? deferredQuery : ""}>
							{results ? (
								<SearchResults results={results} query={deferredQuery} onJump={jump} />
							) : (
								<>
									{listOnly && <SectionList onOpen={(id) => select(id)} />}
									<div
										key={section}
										role="tabpanel"
										id="settings-panel"
										aria-labelledby={`settings-tab-${section}`}
										className={cn(
											listOnly && "hidden md:block",
											animate && "animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out",
										)}
									>
										<SectionHeader section={section} onBack={close} />
										<SectionBody section={section} />
									</div>
								</>
							)}
						</SettingsQuery.Provider>
					</div>
				</div>
			</div>
		</div>
	);
}
