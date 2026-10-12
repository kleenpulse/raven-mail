"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Clock3, Inbox, MailQuestion, Sparkles, Timer } from "lucide-react";
import { toast } from "sonner";
import { AnswerCard, StageTrail } from "@/components/jev/ask-answer";
import type { AskTurn } from "@/components/jev/ask-store";
import type { AskOptions } from "@/components/jev/use-ask";
import { DemoBadge, DemoGuard } from "@/components/landing/demo-guard";
import { intentOf, useDemoAsk } from "@/components/landing/demo-ask";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { formatDuration } from "@/lib/jev/ask/format";
import type { DemoAsk } from "@/lib/landing/demo";
import { cn } from "@/lib/utils";

const TYPE_MS = 28;
/** Room for a typed question wrapping one line more than the suggestions do. */
const BUBBLE_SLACK = 24;

export type DemoKpis = { unread: number; needsReply: number; waitingOn: number; replyMin: number | null };

/**
 * The Ask tray, replaying answers the real pipeline computed on the demo
 * mailbox: the question types itself, stages tick, the answer lands.
 */
export function AskDemo({ asks, kpis }: { asks: DemoAsk[]; kpis: DemoKpis }) {
	const router = useRouter();
	const reduced = useReducedMotion();
	const ref = React.useRef<HTMLDivElement>(null);
	const [turn, setTurn] = React.useState<AskTurn | null>(null);
	const [draft, setDraft] = React.useState("");
	const [typing, setTyping] = React.useState(false);
	const [feedback, setFeedback] = React.useState<Record<string, "up" | "down">>({});
	const timers = React.useRef<number[]>([]);
	const started = React.useRef(false);
	const handled = React.useRef(0);
	const chips = React.useMemo(() => asks.filter((a) => a.chip), [asks]);
	const chipIntents = React.useMemo(() => new Set<string>(chips.map((c) => c.intent)), [chips]);

	// The answer area holds the tallest demo answer's height from the start, so
	// thinking, typing and any answer land without resizing the panel.
	const areaRef = React.useRef<HTMLDivElement>(null);
	const sizerRef = React.useRef<HTMLDivElement>(null);
	const [areaH, setAreaH] = React.useState<number | null>(null);
	const sizers = React.useMemo(
		() => asks.map((a): AskTurn => ({ id: a.intent, question: a.question, status: "done", stages: a.stages, answer: a.answer, at: 0 })),
		[asks],
	);
	// Measure, then drop the copies in the same commit: never painted, and their
	// Mail links never reach Next's viewport prefetch.
	React.useLayoutEffect(() => {
		const sizer = sizerRef.current;
		if (areaH !== null || !sizer || !ref.current) return;
		// Rects are in zoomed pixels; min-height is set in the panel's own (pre-zoom) pixels.
		const zoom = Number(getComputedStyle(ref.current).zoom) || 1;
		// Phones size for the chip answers only; a taller answer a board card asks for may grow the panel.
		const phone = window.matchMedia("(width < 40rem)").matches;
		const measured = Array.from(sizer.children).filter((c) => !phone || c.hasAttribute("data-chip"));
		const tallest = Math.max(...measured.map((c) => c.getBoundingClientRect().height));
		setAreaH(Math.ceil(tallest / zoom) + BUBBLE_SLACK);
	}, [areaH]);
	// Re-measure when the width changes (zoom steps change it too) and once web fonts land.
	React.useEffect(() => {
		const area = areaRef.current;
		if (!area) return;
		let width = area.clientWidth;
		const observer = new ResizeObserver(() => {
			if (area.clientWidth === width) return;
			width = area.clientWidth;
			setAreaH(null);
		});
		observer.observe(area);
		void document.fonts?.ready.then(() => setAreaH(null));
		return () => observer.disconnect();
	}, []);

	const stop = React.useCallback(() => {
		for (const t of timers.current) window.clearTimeout(t);
		timers.current = [];
	}, []);
	React.useEffect(() => stop, [stop]);

	const replay = React.useCallback(
		(ask: DemoAsk, question = ask.question, typeIt = true) => {
			stop();
			started.current = true;
			const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
			const id = `${ask.intent}-${Date.now()}`;
			const base: AskTurn = { id, question, status: "running", stages: [], at: Date.now() };
			const patch = (next: Partial<AskTurn>) => setTurn((t) => (t?.id === id ? { ...t, ...next } : t));

			if (reduced) {
				setTyping(false);
				setDraft("");
				setTurn({ ...base, status: "done", stages: ask.stages, answer: ask.answer });
				return;
			}
			const run = () => {
				setTyping(false);
				setDraft("");
				setTurn({ ...base, stages: [{ stage: "understand", detail: "Reading your question" }] });
				later(620, () => patch({ stages: ask.stages.slice(0, 1) }));
				later(1250, () => patch({ stages: ask.stages }));
				later(2000, () => patch({ status: "done", answer: ask.answer }));
			};
			if (!typeIt) return run();
			setTurn(null);
			setTyping(true);
			for (let n = 1; n <= question.length; n++) later(n * TYPE_MS, () => setDraft(question.slice(0, n)));
			later(question.length * TYPE_MS + 260, run);
		},
		[reduced, stop],
	);

	const nudge = React.useCallback(() => {
		toast("The demo mailbox knows a handful of questions", {
			id: "demo-ask",
			description: "Connect your own and ask Jev anything.",
			action: { label: "Connect", onClick: () => router.push("/login") },
		});
	}, [router]);

	const ask = React.useCallback(
		(question: string, options?: AskOptions) => {
			const match = asks.find((a) => a.intent === intentOf(question, options));
			if (match) replay(match, question, false);
			else nudge();
		},
		[asks, replay, nudge],
	);

	// First sight plays the first chip.
	React.useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry?.isIntersecting) return;
				observer.disconnect();
				if (!started.current && chips[0]) replay(chips[0]);
			},
			{ threshold: 0.35 },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [chips, replay]);

	// A card on the board can queue any answer.
	React.useEffect(
		() =>
			useDemoAsk.subscribe(({ request }) => {
				if (!request || request.nonce === handled.current) return;
				handled.current = request.nonce;
				const match = asks.find((a) => a.intent === request.intent);
				if (match) replay(match);
				else nudge();
			}),
		[asks, replay, nudge],
	);

	function submit(e: React.FormEvent) {
		e.preventDefault();
		const question = draft.trim();
		if (question && !typing) ask(question);
	}

	const shown = turn ? { ...turn, feedback: feedback[turn.id] } : null;
	const strip = [
		{ label: "Unread", value: kpis.unread.toLocaleString("en-US"), icon: Inbox },
		{ label: "Needs reply", value: String(kpis.needsReply), icon: MailQuestion },
		{ label: "Waiting on", value: String(kpis.waitingOn), icon: Timer },
		{ label: "Your reply", value: formatDuration(kpis.replyMin), icon: Clock3 },
	];

	return (
		// Phones: two stats, two evidence rows, a bare confidence meter, and no follow-ups (the chips below ask the same things).
		// The height sizer sits inside this panel, so it measures the trimmed answer too.
		// Padding, gaps and type tighten there as well (AnswerCard `compact`).
		<div
			ref={ref}
			className="demo-fit glass rounded-card p-3 shadow-lift max-sm:rounded-[22px] max-sm:p-2 max-sm:[&_[data-slot=evidence]>li:nth-child(n+3)]:hidden max-sm:**:data-[slot=follow-ups]:hidden max-sm:**:data-[slot=source]:hidden max-sm:[&_[data-slot=stats]>div:nth-child(n+3)]:hidden"
		>
			<header className="flex items-center justify-between px-2 pt-1 pb-2 max-sm:px-1.5 max-sm:pt-0.5 max-sm:pb-1.5">
				<p className="font-mono text-[11px] tracking-[0.14em] text-ink-2">
					<span className="text-signal">JEV</span> ANALYSIS
				</p>
				<DemoBadge />
			</header>

			<DemoGuard className="px-1 pb-3 max-sm:px-0 max-sm:pb-2">
				<div ref={areaRef} className="relative min-h-[380px]" style={areaH ? { minHeight: areaH } : undefined}>
					{shown ? (
						<TurnView turn={shown} onAsk={ask} onFeedback={(id, value) => setFeedback((f) => ({ ...f, [id]: value }))} animate />
					) : (
						<p className="absolute inset-0 grid place-items-center text-center text-[13px] text-ink-2">
							{typing ? "" : "Pick a question below, or type your own."}
						</p>
					)}
					{areaH === null && (
						<div ref={sizerRef} aria-hidden inert className="pointer-events-none invisible absolute inset-x-0 top-0">
							{sizers.map((t) => (
								<div key={t.id} data-chip={chipIntents.has(t.id) || undefined}>
									<TurnView turn={t} onAsk={() => {}} />
								</div>
							))}
						</div>
					)}
				</div>
			</DemoGuard>
			<p aria-live="polite" className="sr-only">
				{shown?.status === "done" ? shown.answer?.headline : ""}
			</p>

			<dl className="hidden grid-cols-2 gap-1 sm:grid rounded-[18px] bg-card-nested/80 px-2 py-2 ring-1 ring-glass-border sm:grid-cols-4">
				{strip.map(({ label, value, icon: Icon }) => (
					<div key={label} className="min-w-0 px-2 py-0.5">
						<dt className="truncate text-[11px] text-ink-2">{label}</dt>
						<dd className="flex items-center gap-1.5 font-display text-[17px] tabular">
							<Icon className="size-3.5 shrink-0 text-ink-2" />
							{value}
						</dd>
					</div>
				))}
			</dl>

			<form onSubmit={submit} className="mt-2 flex items-center gap-2 max-sm:mt-0 max-sm:gap-1.5">
				<input
					value={draft}
					onChange={(e) => {
						stop();
						setTyping(false);
						setDraft(e.target.value);
					}}
					placeholder="Ask about the demo inbox…"
					aria-label="Ask Jev about the demo mailbox"
					autoComplete="off"
					maxLength={200}
					className="h-12 min-w-0 flex-1 rounded-pill bg-[linear-gradient(90deg,#eef5f4,#cfe2df)] px-5 text-base text-[#0b1616] outline-none max-sm:h-10 max-sm:px-4 sm:text-[15px] placeholder:text-[#5f7573] focus-visible:ring-2 focus-visible:ring-ring"
				/>
				<button
					type="submit"
					disabled={!draft.trim() || typing}
					aria-label="Send question"
					className="grid size-12 shrink-0 place-items-center rounded-full max-sm:size-10 bg-[#0e2a2a] text-signal-2 ring-1 ring-glass-border transition-[opacity,transform] active:scale-95 disabled:opacity-40"
				>
					<ArrowUp className="size-5 max-sm:size-4" />
				</button>
			</form>

			{/* Phones: two rows that scroll sideways, fading at the right edge. */}
			<div className="mt-2 flex flex-wrap items-center gap-2 px-1 max-sm:grid max-sm:auto-cols-max max-sm:grid-flow-col max-sm:grid-rows-2 max-sm:gap-1.5 max-sm:overflow-x-auto max-sm:px-0 max-sm:scrollbar-none max-sm:mask-[linear-gradient(to_right,black_85%,transparent)]">
				<span className="inline-flex h-8 items-center gap-1.5 rounded-pill px-2.5 text-[12px] text-ink-2 max-sm:hidden">
					<Sparkles className="size-3.5 text-signal [&>path:first-child]:fill-current" />
					Jev
				</span>
				{chips.map((chip) => (
					<button
						key={chip.intent}
						type="button"
						onClick={() => replay(chip)}
						aria-pressed={turn?.id.startsWith(`${chip.intent}-`) ?? false}
						className={cn(
							"inline-flex h-8 items-center rounded-pill bg-card-nested px-3 text-[12px] ring-1 ring-glass-border transition-colors hover:bg-signal-soft max-sm:h-7 max-sm:ring-inset max-sm:px-2.5 max-sm:text-[11px]",
							turn?.id.startsWith(`${chip.intent}-`) && "bg-signal-soft text-foreground",
						)}
					>
						{chip.question}
					</button>
				))}
			</div>
		</div>
	);
}

function TurnView({
	turn,
	onAsk,
	onFeedback,
	animate = false,
}: {
	turn: AskTurn;
	onAsk: (question: string, options?: AskOptions) => void;
	onFeedback?: (id: string, value: "up" | "down") => void;
	animate?: boolean;
}) {
	return (
		<div className="space-y-2.5 max-sm:space-y-2">
			<p className="ml-auto w-fit max-w-[85%] rounded-[18px] rounded-br-md bg-inverse px-3.5 py-2 text-[13px] text-inverse-foreground max-sm:px-3 max-sm:py-1.5 max-sm:text-[12px]">
				{turn.question}
			</p>
			{turn.status === "running" && (
				<div className="rounded-[20px] bg-card-nested p-4 ring-1 ring-glass-border max-sm:rounded-[16px] max-sm:p-3">
					<StageTrail turn={turn} />
				</div>
			)}
			{turn.status === "done" && turn.answer && (
				<div className={cn(animate && "animate-in duration-300 fade-in slide-in-from-bottom-2")}>
					<AnswerCard turn={turn} onAsk={onAsk} onNavigate={() => {}} onFeedback={onFeedback} compact />
				</div>
			)}
		</div>
	);
}
