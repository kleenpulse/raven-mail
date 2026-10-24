"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowUp, Clock3, Inbox, Loader2, MailQuestion, Paperclip, Sparkles, Timer, Trash2, X } from "lucide-react";
import { useAskStore } from "@/components/jev/ask-store";
import { AnswerCard, StageTrail } from "@/components/jev/ask-answer";
import { useAsk, type AskOptions } from "@/components/jev/use-ask";
import { useAskName } from "@/components/jev/ask-name";
import { useOverview } from "@/hooks/use-overview";
import { useDeepTriage } from "@/hooks/use-deep-triage";
import { INTENT_META, SUGGESTED_INTENTS } from "@/lib/jev/ask/catalog";
import { formatDuration } from "@/lib/jev/ask/format";
import { smartChips } from "@/lib/jev/ask/chips";
import { usePref } from "@/lib/prefs/store";
import { cn } from "@/lib/utils";

/** Below this the page counts as "at the top"; per-event moves under JITTER_PX are ignored. */
const TOP_PX = 8;
const JITTER_PX = 6;

/**
 * Visible at the top and while scrolling up, hidden while scrolling down.
 * Each page owns its scroller inside <main>, so this listens in the capture
 * phase (scroll doesn't bubble) and tracks every scroller separately.
 */
function useShowOnScrollUp(resetKey: string) {
	// Hidden only for the key it was hidden on, so a new page starts visible.
	const [hiddenOn, setHiddenOn] = React.useState<string | null>(null);

	React.useEffect(() => {
		const setVisible = (on: boolean) => setHiddenOn(on ? null : resetKey);
		const last = new WeakMap<Element, number>();
		const onScroll = (e: Event) => {
			const el = e.target;
			if (!(el instanceof Element) || !el.closest("main")) return;
			const top = el.scrollTop;
			const prev = last.get(el);
			if (top <= TOP_PX) {
				last.set(el, top);
				setVisible(true);
				return;
			}
			if (prev === undefined) {
				last.set(el, top);
				return;
			}
			const delta = top - prev;
			if (Math.abs(delta) < JITTER_PX) return;
			last.set(el, top);
			setVisible(delta < 0);
		};
		document.addEventListener("scroll", onScroll, { capture: true, passive: true });
		return () => document.removeEventListener("scroll", onScroll, { capture: true });
	}, [resetKey]);

	return hiddenOn !== resetKey;
}

function TurnView({ turn, onAsk, onNavigate }: { turn: ReturnType<typeof useAskStore.getState>["turns"][number]; onAsk: (q: string, o?: AskOptions) => void; onNavigate: () => void }) {
	return (
		<li className="space-y-2.5">
			<p className="ml-auto w-fit max-w-[85%] rounded-[18px] rounded-br-md bg-inverse px-3.5 py-2 text-[13px] text-inverse-foreground">
				{turn.question}
			</p>
			{turn.status === "running" && (
				<div className="rounded-[20px] bg-popover/80 p-4 ring-1 ring-border dark:bg-card-nested dark:ring-glass-border">
					<StageTrail turn={turn} />
				</div>
			)}
			{turn.status === "done" && turn.answer && <AnswerCard turn={turn} onAsk={onAsk} onNavigate={onNavigate} />}
			{turn.status === "error" && (
				<p className="rounded-[16px] bg-card-nested px-4 py-3 text-[13px] text-ink-2 ring-1 ring-border dark:ring-glass-border">
					<span className="text-critical">[</span> {turn.error ?? "Something went wrong."}
				</p>
			)}
		</li>
	);
}

/**
 * The video's bottom prompt tray: KPI strip, pill input, context chips — and
 * "JEV ANALYSIS" (or "KAGE ANALYSIS") answers rising above it. Collapses to a small pill.
 */
export function AskTray() {
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const open = useAskStore((s) => s.open);
	const turns = useAskStore((s) => s.turns);
	const focusNonce = useAskStore((s) => s.focusNonce);
	const heroVisible = useAskStore((s) => s.heroVisible);
	const setOpen = useAskStore((s) => s.setOpen);
	const requestFocus = useAskStore((s) => s.requestFocus);
	const clear = useAskStore((s) => s.clear);
	const ask = useAsk();
	const { data: overview } = useOverview(30, { enabled: open });
	const deep = useDeepTriage();
	const [value, setValue] = React.useState("");
	const [useContext, setUseContext] = React.useState(true);
	const inputRef = React.useRef<HTMLInputElement>(null);
	const listRef = React.useRef<HTMLOListElement>(null);
	const showPill = usePref("appearance.askPill");
	const name = useAskName();
	const pillInView = useShowOnScrollUp(pathname);

	const contextUid = pathname === "/mail" ? searchParams.get("uid") : null;
	const contextFolder = searchParams.get("folder") ?? "INBOX";
	const running = turns.some((t) => t.status === "running");
	const last = turns[turns.length - 1];

	React.useEffect(() => {
		if (focusNonce > 0) requestAnimationFrame(() => inputRef.current?.focus());
	}, [focusNonce]);

	React.useEffect(() => {
		listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
	}, [turns.length, last?.status, last?.stages.length]);

	React.useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, setOpen]);

	const run = React.useCallback(
		(question: string, options: AskOptions = {}) => {
			const context = contextUid && useContext ? { folder: contextFolder, uid: contextUid } : undefined;
			void ask(question, { ...options, context: options.context ?? context });
		},
		[ask, contextFolder, contextUid, useContext],
	);

	function submit(e: React.FormEvent) {
		e.preventDefault();
		if (!value.trim() || running) return;
		run(value);
		setValue("");
	}

	const chips = overview
		? smartChips(overview)
		: SUGGESTED_INTENTS.slice(0, 4).map((i) => ({ label: INTENT_META[i].example, intent: i }));

	const kpis = overview
		? [
				{ label: "Unread", value: overview.kpis.unread.toLocaleString(), icon: Inbox },
				{ label: "Needs reply", value: String(overview.kpis.needsReply), icon: MailQuestion },
				{ label: "Waiting on", value: String(overview.kpis.waitingOn), icon: Timer },
				{ label: "Your reply", value: formatDuration(overview.replyTimes.yours.medianMin), icon: Clock3 },
			]
		: null;

	if (!open) {
		// Over Mail the pill would sit on the list; the rail button and the palette cover it there.
		if (!showPill || heroVisible || pathname.startsWith("/mail")) return null;
		return (
			<button
				type="button"
				onClick={requestFocus}
				inert={!pillInView}
				data-hidden={!pillInView || undefined}
				className={cn(
					"glass-frost fixed bottom-6 left-1/2 z-30 hidden h-12 -translate-x-1/2 items-center gap-2.5 rounded-pill px-5 text-sm shadow-lift inset-shadow-[0_1px_0_var(--glass-edge)] transition-[translate,box-shadow,opacity,filter] duration-300 ease-out hover:-translate-y-0.5 hover:shadow-glow md:left-[calc(50%+42px)] md:flex",
					"data-hidden:pointer-events-none data-hidden:translate-y-3 data-hidden:opacity-0 data-hidden:blur-sm",
				)}
			>
				<Sparkles className="[&>path:first-child]:fill-current size-4 text-signal-ink dark:text-signal" />
				Ask {name}
			</button>
		);
	}

	return (
		<div className="pointer-events-none fixed inset-x-0 bottom-[92px] z-40 flex justify-center px-3 md:bottom-5 md:pl-[84px]">
			<section
				aria-label={`Ask ${name}`}
				// Not a dialog, but mail shortcuts must still stand down while focus is in it (lib/keyboard).
				data-overlay
				className="glass pointer-events-auto flex max-h-[min(78vh,760px)] w-full max-w-[760px] flex-col rounded-card p-3 shadow-lift entrance"
			>
				<header className="flex items-center justify-between px-2 pt-1 pb-2">
					<p className="font-mono text-[11px] tracking-[0.14em] text-ink-2">
						<span className="text-signal-ink dark:text-signal">{name.toUpperCase()}</span> ANALYSIS
					</p>
					<div className="flex items-center gap-1">
						{turns.length > 0 && (
							<button
								type="button"
								onClick={clear}
								aria-label="Clear conversation"
								className="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-card-nested hover:text-foreground"
							>
								<Trash2 className="size-3.5" />
							</button>
						)}
						<button
							type="button"
							onClick={() => setOpen(false)}
							aria-label={`Close Ask ${name}`}
							className="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-card-nested hover:text-foreground"
						>
							<X className="size-4" />
						</button>
					</div>
				</header>

				{turns.length > 0 && (
					<ol ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 pb-3 auto-scroll">
						{turns.map((turn) => (
							<TurnView key={turn.id} turn={turn} onAsk={run} onNavigate={() => setOpen(false)} />
						))}
					</ol>
				)}
				<p aria-live="polite" className="sr-only">
					{last?.status === "running"
						? (last.stages[last.stages.length - 1]?.detail ?? `${name} is thinking`)
						: last?.status === "done"
							? last.answer?.headline
							: ""}
				</p>

				{kpis && (
					<dl className="grid grid-cols-4 gap-1 rounded-[18px] bg-card-nested/80 px-2 py-2 ring-1 ring-border dark:ring-glass-border">
						{kpis.map(({ label, value: v, icon: Icon }) => (
							<div key={label} className="min-w-0 px-2">
								<dt className="truncate text-[11px] text-ink-2">{label}</dt>
								<dd className="flex items-center gap-1.5 font-display text-[17px] tabular">
									<Icon className="size-3.5 shrink-0 text-ink-2" />
									{v}
								</dd>
							</div>
						))}
					</dl>
				)}

				<form onSubmit={submit} className="mt-2 flex items-center gap-2">
					<input
						ref={inputRef}
						value={value}
						onChange={(e) => setValue(e.target.value)}
						placeholder="Ask about your inbox…"
						aria-label={`Ask ${name}`}
						autoComplete="off"
						maxLength={500}
						className={cn(
							"h-12 min-w-0 flex-1 rounded-pill bg-sheet px-5 text-[15px] text-foreground ring-1 ring-border outline-none placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-ring",
							// Nebula: the video's luminous input bar
							"dark:bg-[linear-gradient(90deg,#eef5f4,#cfe2df)] dark:text-[#0b1616] dark:placeholder:text-[#5f7573] dark:ring-0",
						)}
					/>
					<button
						type="submit"
						disabled={!value.trim() || running}
						aria-label="Send question"
						className="grid size-12 shrink-0 place-items-center rounded-full bg-inverse text-inverse-foreground transition-[opacity,transform] active:scale-95 disabled:opacity-40 dark:bg-[#0e2a2a] dark:text-signal-2 dark:ring-1 dark:ring-glass-border"
					>
						{running ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-5" />}
					</button>
				</form>

				<div className="mt-2 flex flex-wrap items-center gap-2 px-1">
					<span className="inline-flex h-8 items-center gap-1.5 rounded-pill px-2.5 text-[12px] text-ink-2">
						<Sparkles className="[&>path:first-child]:fill-current size-3.5 text-signal-ink dark:text-signal" />
						{name}
					</span>
					{contextUid && (
						<button
							type="button"
							onClick={() => setUseContext((v) => !v)}
							aria-pressed={useContext}
							className={cn(
								"inline-flex h-8 items-center gap-1.5 rounded-pill px-3 text-[12px] ring-1 ring-border transition-colors dark:ring-glass-border",
								useContext ? "bg-signal-soft text-foreground" : "text-ink-2",
							)}
						>
							<Paperclip className="size-3" />
							This email
						</button>
					)}
					<button
						type="button"
						onClick={deep.run}
						disabled={deep.pending}
						className="inline-flex h-8 items-center gap-1.5 rounded-pill px-3 text-[12px] ring-1 ring-border transition-colors hover:bg-signal-soft disabled:opacity-60 dark:ring-glass-border"
						title={name === "Kage" ? "Let Kage triage your last 48 hours (built in, no key needed)" : "Let Jev triage your last 48 hours (uses your TypeSafe key)"}
					>
						{deep.pending ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="[&>path:first-child]:fill-current size-3" />}
						{deep.data ? "Re-triage" : "Deep triage"}
					</button>
					{!value &&
						chips.slice(0, 3).map((c) => (
							<button
								key={c.label}
								type="button"
								onClick={() => run(c.label, { forcedIntent: c.intent })}
								className="inline-flex h-8 items-center rounded-pill bg-card-nested px-3 text-[12px] ring-1 ring-border transition-colors hover:bg-signal-soft dark:ring-glass-border"
							>
								{c.label}
							</button>
						))}
				</div>
			</section>
		</div>
	);
}
