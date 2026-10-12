"use client";

import * as React from "react";
import type { SenderStat } from "@/lib/insights/types";
import { cn } from "@/lib/utils";
import { CHIP_H, type OrbitCategory, type OrbitLayout, type OrbitSender } from "./layout";
import { displayName, formatCount } from "./format";
import type { OrbitVocab } from "./vocab";

export type OrbitIds = {
	sun: string;
	sunGlow: string;
	wash: string;
	glow: string;
	gloss: (key: "person" | "machine" | "cat-0" | "cat-1") => string;
	beam: (i: number) => string;
	hint: string;
};

export function makeOrbitIds(uid: string): OrbitIds {
	return {
		sun: `${uid}-sun`,
		sunGlow: `${uid}-sun-glow`,
		wash: `${uid}-wash`,
		glow: `${uid}-glow`,
		gloss: (key) => `${uid}-gloss-${key}`,
		beam: (i) => `${uid}-beam-${i}`,
		hint: `${uid}-hint`,
	};
}

const EASE = "var(--ease-out-quint)";



/** Deterministic starfield for the Nebula skin (seeded by stage size). */
function stars(width: number, height: number) {
	let a = (Math.imul(width, 73856093) ^ Math.imul(height, 19349663)) >>> 0;
	const rand = () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const count = Math.round(clampNum((width * height) / 9000, 18, 64));
	return Array.from({ length: count }, (_, i) => ({
		x: Math.round(rand() * width * 10) / 10,
		y: Math.round(rand() * height * 10) / 10,
		r: 0.45 + rand() * 0.8,
		o: 0.18 + rand() * 0.4,
		twinkle: i % 9 === 0,
		dur: 2.6 + rand() * 3.2,
	}));
}

function clampNum(v: number, lo: number, hi: number) {
	return Math.min(hi, Math.max(lo, v));
}

function Gloss({ id, color }: { id: string; color: string }) {
	return (
		<radialGradient id={id} cx="0.4" cy="0.36" r="0.72" fx="0.32" fy="0.26">
			<stop offset="0" style={{ stopColor: `color-mix(in oklab, ${color} 30%, white)` }} />
			<stop offset="0.45" style={{ stopColor: color }} />
			<stop offset="1" style={{ stopColor: `color-mix(in oklab, ${color} 52%, black)` }} />
		</radialGradient>
	);
}

export type SceneFocus = { id: string; x: number; y: number; r: number } | null;

type SceneProps = {
	layout: OrbitLayout;
	senders: Map<string, SenderStat>;
	ids: OrbitIds;
	focus: SceneFocus;
	activeId: string | null;
	hoverId: string | null;
	tipId: string | null;
	ambient: boolean;
	/** A focus/unfocus glide is running; otherwise orbs snap (e.g. on resize). */
	gliding: boolean;
	now: number | null;
	vocab: OrbitVocab;
	ariaLabelFor: (s: OrbitSender) => string;
	onHover: (id: string | null) => void;
	onFocusNode: (id: string | null) => void;
	onActivate: (id: string) => void;
	onNavigate: (id: string, key: string) => void;
};

const NAV_KEYS = new Set(["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"]);

export const OrbitScene = React.memo(function OrbitScene({
	layout,
	senders,
	ids,
	focus,
	activeId,
	hoverId,
	tipId,
	ambient,
	gliding,
	now,
	vocab,
	ariaLabelFor,
	onHover,
	onFocusNode,
	onActivate,
	onNavigate,
}: SceneProps) {
	const { width, height, cx, cy, sun, rings, categories } = layout;
	const focused = focus !== null;
	const field = React.useMemo(() => stars(width, height), [width, height]);
	const hovered = hoverId ? layout.senders.find((s) => s.id === hoverId) : undefined;
	const fade = { opacity: focused ? 0 : 1, transition: `opacity 320ms ${EASE}` };
	const glowR = sun.ringInner + sun.ringMax + clampNum(layout.scale * 0.09, 24, 48);

	return (
		<div className="absolute inset-0">
			{/*
			 * Ambient motion lives in HTML layers around the SVG so it never repaints the
			 * filtered scene, and in `hidden dark:block` so Ember pays nothing for it
			 * (CSS animations stop under display:none; SMIL would keep ticking).
			 */}
			<div aria-hidden className="pointer-events-none absolute inset-0 hidden dark:block" style={fade}>
				{ambient && (
					<div
						className="absolute animate-pulse rounded-full"
						style={{
							left: cx - glowR * 1.25,
							top: cy - glowR * 1.25,
							width: glowR * 2.5,
							height: glowR * 2.5,
							background: "radial-gradient(closest-side, rgb(230 194 122 / 0.16), rgb(230 194 122 / 0.05) 55%, transparent)",
							animationDuration: "6s",
						}}
					/>
				)}
				{field
					.filter((s) => s.twinkle)
					.map((s, i) => (
						<span
							key={i}
							className={cn("absolute size-[2.5px] rounded-full bg-foreground", ambient && "animate-pulse")}
							style={{ left: s.x - 1.25, top: s.y - 1.25, opacity: s.o + 0.25, animationDuration: `${s.dur}s` }}
						/>
					))}
			</div>
			<svg
				width={width}
				height={height}
				viewBox={`0 0 ${width} ${height}`}
				className="absolute inset-0 block select-none"
				role="group"
				aria-label={vocab.sceneLabel}
				aria-describedby={ids.hint}
			>
				<defs>
					<radialGradient id={ids.sun} cx="0.4" cy="0.36" r="0.7" fx="0.34" fy="0.28">
						<stop offset="0" style={{ stopColor: "#fff6de" }} />
						<stop offset="0.38" style={{ stopColor: "var(--signal)" }} />
						<stop offset="1" style={{ stopColor: "color-mix(in oklab, var(--signal) 45%, black)" }} />
					</radialGradient>
					<radialGradient id={ids.sunGlow}>
						<stop offset="0.25" style={{ stopColor: "var(--signal)", stopOpacity: 0.34 }} />
						<stop offset="0.6" style={{ stopColor: "var(--signal)", stopOpacity: 0.08 }} />
						<stop offset="1" style={{ stopColor: "var(--signal)", stopOpacity: 0 }} />
					</radialGradient>
					<radialGradient id={ids.wash}>
						<stop offset="0" style={{ stopColor: "var(--beam-2)", stopOpacity: 0.07 }} />
						<stop offset="1" style={{ stopColor: "var(--beam-2)", stopOpacity: 0 }} />
					</radialGradient>
					<filter id={ids.glow} x="-40%" y="-40%" width="180%" height="180%">
						<feGaussianBlur stdDeviation="3.2" />
					</filter>
					<Gloss id={ids.gloss("person")} color="var(--orbit-person)" />
					<Gloss id={ids.gloss("machine")} color="var(--orbit-machine)" />
					<Gloss id={ids.gloss("cat-0")} color="var(--orbit-cat-0)" />
					<Gloss id={ids.gloss("cat-1")} color="var(--orbit-cat-1)" />
					{categories.map((c, i) => (
						<linearGradient
							key={c.id}
							id={ids.beam(i)}
							gradientUnits="userSpaceOnUse"
							x1={c.beam.from.x}
							y1={c.beam.from.y}
							x2={c.beam.to.x}
							y2={c.beam.to.y}
						>
							<stop offset="0" style={{ stopColor: "var(--beam-1)", stopOpacity: 0.95 }} />
							<stop offset="0.55" style={{ stopColor: "var(--beam-1)", stopOpacity: 0.5 }} />
							<stop offset="1" style={{ stopColor: "var(--beam-1)", stopOpacity: 0.08 }} />
						</linearGradient>
					))}
				</defs>

				{/* Backdrop: nebula wash, stars, orbit guides */}
				<g aria-hidden className="pointer-events-none" style={fade}>
					<ellipse
						cx={cx}
						cy={cy}
						rx={rings.r2.rx + 90}
						ry={rings.r2.ry + 70}
						fill={`url(#${ids.wash})`}
						className="hidden dark:inline"
					/>
					<g className="hidden dark:inline">
						{[false, true].map((bright) => (
							<path
								key={String(bright)}
								d={field
									.filter((s) => !s.twinkle && s.o > 0.38 === bright)
									.map((s) => `M${s.x} ${s.y}h0`)
									.join("")}
								className="stroke-foreground"
								strokeOpacity={bright ? 0.42 : 0.2}
								strokeWidth={bright ? 1.6 : 1.1}
								strokeLinecap="round"
							/>
						))}
					</g>
					<ellipse
						cx={cx}
						cy={cy}
						rx={rings.r1.rx}
						ry={rings.r1.ry}
						fill="none"
						className="stroke-border dark:stroke-glass-border"
						strokeWidth={1}
					/>
					<ellipse
						cx={cx}
						cy={cy}
						rx={rings.r2.rx}
						ry={rings.r2.ry}
						fill="none"
						className="stroke-border dark:stroke-glass-border"
						strokeWidth={1}
						strokeDasharray="1 7"
						strokeLinecap="round"
					/>
				</g>

				{/* Beams: gold/coral core, blurred halo + cyan filament in Nebula */}
				<g aria-hidden className="pointer-events-none" style={fade} fill="none" strokeLinecap="round">
					{categories.map((c, i) => {
						const delay = { ["--draw-delay" as string]: `${220 + i * 60}ms` };
						const lit = hovered?.category === c.id;
						return (
							<g key={c.id}>
								<path
									d={c.beam.d}
									pathLength={1}
									stroke={`url(#${ids.beam(i)})`}
									className="draw-on hidden dark:inline"
									filter={`url(#${ids.glow})`}
									style={{
										...delay,
										strokeWidth: c.beam.width * 3,
										opacity: lit ? 0.5 : 0.28,
										transition: `stroke-width 600ms ${EASE}, opacity 240ms`,
									}}
								/>
								<path
									d={c.beam.d}
									pathLength={1}
									stroke={`url(#${ids.beam(i)})`}
									className="draw-on"
									style={{ ...delay, strokeWidth: c.beam.width, transition: `stroke-width 600ms ${EASE}` }}
								/>
								<path
									d={c.beam.filament}
									pathLength={1}
									className="draw-on hidden stroke-beam-2 dark:inline"
									strokeWidth={0.8}
									style={{ ["--draw-delay" as string]: `${320 + i * 60}ms`, opacity: 0.45 }}
								/>
							</g>
						);
					})}
				</g>

				{/* Dotted links category → sender */}
				<g aria-hidden className="pointer-events-none" style={fade} fill="none" strokeLinecap="round">
					{layout.senders.map((s) => (
						<path
							key={s.id}
							d={s.link}
							className={cn(
								"entrance transition-[stroke,opacity] duration-200",
								s.id === hoverId ? "stroke-signal" : "stroke-ink-3 dark:stroke-beam-2/45",
							)}
							strokeWidth={s.id === hoverId ? 1.4 : 1.1}
							strokeDasharray="0.5 4.5"
							style={{ ["--i" as string]: 10 + (s.ring % 6), opacity: s.weight > 0 ? 1 : 0.45 }}
						/>
					))}
				</g>

				{/* The sun: you. Its tick ring is your own mail per day. */}
				<g aria-hidden className="pointer-events-none" style={fade}>
					<g className="animate-bloom origin-center [transform-box:fill-box]">
						<circle cx={cx} cy={cy} r={glowR} fill={`url(#${ids.sunGlow})`} className="hidden dark:inline" />
						<circle
							cx={cx}
							cy={cy}
							r={sun.ringInner + sun.ringMax + 4}
							className="fill-signal-soft dark:fill-signal/6"
						/>
						<path
							d={sun.ring}
							pathLength={1}
							className="draw-on stroke-signal dark:stroke-signal/80"
							strokeWidth={1.6}
							strokeLinecap="round"
							fill="none"
							style={{ ["--draw-delay" as string]: "140ms" }}
						/>
						<circle cx={cx} cy={cy} r={sun.r + 3} fill="none" className="stroke-signal/60 dark:stroke-signal/30" />
						<circle
							cx={cx}
							cy={cy}
							r={sun.r}
							className="fill-inverse dark:fill-(--orbit-sun-paint) dark:drop-shadow-[0_0_16px_rgb(230_194_122/0.55)]"
						/>
						<text
							x={cx}
							y={cy}
							textAnchor="middle"
							dominantBaseline="central"
							className="fill-inverse-foreground font-display text-[12px] font-semibold tracking-[-0.01em] dark:fill-primary-foreground"
						>
							{vocab.sun}
						</text>
					</g>
				</g>

				{/* Categories */}
				<g style={fade}>
					{categories.map((c) => (
						<CategoryNode key={c.id} c={c} ids={ids} vocab={vocab} dim={!!hovered && hovered.category !== c.id} />
					))}
				</g>

				{/* Senders */}
				<g>
					{layout.senders.map((s) => {
						const isFocus = focus?.id === s.id;
						const stat = senders.get(s.id);
						return (
							<SenderNode
								key={s.id}
								s={s}
								ids={ids}
								unread={stat?.unread ?? 0}
								tabbable={activeId === s.id}
								hovered={hoverId === s.id}
								dim={focused ? !isFocus : !!hovered && hovered.category !== s.category}
								hidden={focused && !isFocus}
								target={isFocus ? focus : null}
								gliding={gliding}
								ariaLabel={ariaLabelFor(s)}
								onHover={onHover}
								onFocusNode={onFocusNode}
								onActivate={onActivate}
								onNavigate={onNavigate}
							/>
						);
					})}
				</g>
			</svg>

			{/* Mail travelling home: sparks ride each beam inbound, faster when the category is fresher. */}
			{ambient && !focused && (
				<div aria-hidden className="pointer-events-none absolute inset-0 hidden overflow-hidden dark:block">
					{categories.flatMap((c) =>
						Array.from({ length: c.particles.count }, (_, j) => (
							<Spark
								key={`${c.id}-${j}`}
								track={c.beam.track}
								dur={c.particles.dur}
								phase={(j + 0.35) / c.particles.count}
							/>
						)),
					)}
				</div>
			)}

			<OrbitTooltip layout={layout} senders={senders} tipId={focused ? null : tipId} now={now} vocab={vocab} />
		</div>
	);
});

/**
 * One point of light riding a beam from its category home to the sun.
 * Web Animations on transform/opacity run on the compositor, so the filtered
 * SVG underneath never repaints; hidden (Ember) layers render nothing.
 */
function Spark({ track, dur, phase }: { track: string; dur: number; phase: number }) {
	const ref = React.useRef<HTMLSpanElement>(null);
	React.useEffect(() => {
		const el = ref.current;
		const dot = el?.firstElementChild as HTMLElement | null;
		if (!el || !dot || typeof el.animate !== "function") return;
		const points = track
			.split(" ")
			.map((p) => p.split(",").map(Number) as [number, number])
			.reverse();
		const timing: KeyframeAnimationOptions = {
			duration: dur * 1000,
			delay: -phase * dur * 1000,
			iterations: Infinity,
			easing: "cubic-bezier(0.45, 0, 0.3, 1)",
		};
		const move = el.animate(
			points.map(([x, y]) => ({ transform: `translate(${x}px, ${y}px)` })),
			timing,
		);
		const glow = dot.animate(
			[{ opacity: 0 }, { opacity: 1, offset: 0.14 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }],
			timing,
		);
		return () => {
			move.cancel();
			glow.cancel();
		};
	}, [track, dur, phase]);
	return (
		<span ref={ref} className="absolute top-0 left-0 will-change-transform">
			<span className="block size-[3.5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#fff8e6] opacity-0 shadow-[0_0_6px_2px_rgb(230_194_122/0.5)]" />
		</span>
	);
}

function CategoryNode({ c, ids, vocab, dim }: { c: OrbitCategory; ids: OrbitIds; vocab: OrbitVocab; dim: boolean }) {
	const tone = `var(--orbit-cat-${c.tone})`;
	const label = c.labelPos;
	return (
		<g
			transform={`translate(${c.x} ${c.y})`}
			role="img"
			aria-label={`${c.label}: ${c.shareText} of ${vocab.mass}, ${formatCount(c.value)} ${vocab.unit[1]}`}
			style={{ ["--cat" as string]: tone, opacity: dim ? 0.6 : 1, transition: "opacity 240ms" }}
		>
			<g className="animate-bloom origin-center [transform-box:fill-box]" style={{ animationDelay: `${380 + c.order * 60}ms` }}>
				<circle
					r={c.slotR + 12}
					fill="none"
					className="hidden stroke-(--cat) dark:inline"
					strokeOpacity={0.14}
					strokeWidth={1}
				/>
				<circle
					r={c.r + 6}
					fill="none"
					className="stroke-(--cat)"
					strokeOpacity={0.35}
					strokeWidth={1}
					style={{ r: c.r + 6, transition: `r 600ms ${EASE}` }}
				/>
				<circle
					r={c.r}
					className="fill-(--cat) dark:fill-(--cat-gloss) dark:drop-shadow-[0_0_10px_color-mix(in_oklab,var(--cat)_60%,transparent)]"
					style={{
						["--cat-gloss" as string]: `url(#${ids.gloss(c.tone === 0 ? "cat-0" : "cat-1")})`,
						r: c.r,
						transition: `r 600ms ${EASE}`,
					}}
				/>
			</g>
			{label && (
				<g
					aria-hidden
					className="entrance pointer-events-none"
					style={{ ["--i" as string]: 9 + c.order }}
					transform={`translate(${-c.x} ${-c.y})`}
				>
					<text
						x={label.x}
						y={label.nameY}
						textAnchor={label.anchor}
						dominantBaseline="central"
						className="orbit-halo fill-foreground font-display tracking-[-0.01em]"
						style={{ fontSize: label.size }}
					>
						{c.label}
					</text>
					{label.chip && (
						<g>
							<rect
								x={label.chip.x}
								y={label.chip.y}
								width={label.chip.w}
								height={label.chip.h}
								rx={5}
								className="fill-sheet stroke-signal/30 dark:fill-signal-soft dark:stroke-signal/25"
								strokeWidth={1}
							/>
							<text
								x={label.chip.x + label.chip.w / 2}
								y={label.chip.y + label.chip.h / 2}
								textAnchor="middle"
								dominantBaseline="central"
								className="tabular fill-signal-ink font-mono text-[10px] font-medium dark:fill-signal"
							>
								{c.shareText}
							</text>
						</g>
					)}
				</g>
			)}
		</g>
	);
}

type SenderNodeProps = {
	s: OrbitSender;
	ids: OrbitIds;
	unread: number;
	tabbable: boolean;
	hovered: boolean;
	dim: boolean;
	hidden: boolean;
	target: SceneFocus;
	gliding: boolean;
	ariaLabel: string;
	onHover: (id: string | null) => void;
	onFocusNode: (id: string | null) => void;
	onActivate: (id: string) => void;
	onNavigate: (id: string, key: string) => void;
};

function SenderNode({
	s,
	ids,
	unread,
	tabbable,
	hovered,
	dim,
	hidden,
	target,
	gliding,
	ariaLabel,
	onHover,
	onFocusNode,
	onActivate,
	onNavigate,
}: SenderNodeProps) {
	const kind = s.person ? "person" : "machine";
	const x = target ? target.x : s.x;
	const y = target ? target.y : s.y;
	const r = target ? target.r : s.r;
	const quiet = s.weight === 0;
	const hit = Math.max(s.slotR + 6, 13);
	const dot = { cx: r * 0.74, cy: -r * 0.74 };
	const chip = s.label.chip;
	const name = s.label.name;

	return (
		<g
			data-orbit-sender={s.id}
			role="button"
			tabIndex={tabbable ? 0 : -1}
			aria-label={ariaLabel}
			className="group/node cursor-pointer outline-none"
			style={{
				transform: `translate(${x}px, ${y}px)`,
				opacity: hidden ? 0 : dim ? 0.5 : 1,
				transition: gliding ? `transform 640ms ${EASE}, opacity 300ms ${EASE}` : `opacity 300ms ${EASE}`,
				pointerEvents: hidden ? "none" : undefined,
				["--node" as string]: `var(--orbit-${kind})`,
				["--node-gloss" as string]: `url(#${ids.gloss(kind)})`,
			}}
			onClick={() => onActivate(s.id)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onActivate(s.id);
				} else if (NAV_KEYS.has(e.key)) {
					e.preventDefault();
					onNavigate(s.id, e.key);
				}
			}}
			onFocus={() => onFocusNode(s.id)}
			onBlur={() => onFocusNode(null)}
			onPointerEnter={() => onHover(s.id)}
			onPointerLeave={() => onHover(null)}
		>
			<g className="animate-bloom origin-center [transform-box:fill-box]" style={{ animationDelay: `${560 + s.ring * 18}ms` }}>
				<g
					className="origin-center transition-transform duration-200 [transform-box:fill-box]"
					style={{ transform: hovered && !target ? "scale(1.14)" : undefined }}
				>
					<circle r={hit} fill="transparent" />
					<circle
						r={s.slotR + 5}
						fill="none"
						className="stroke-ring opacity-0 transition-opacity group-focus-visible/node:opacity-100"
						strokeWidth={2}
						style={{ r: target ? r + 6 : s.slotR + 5, transition: `r 520ms ${EASE}, opacity 150ms` }}
					/>
					<circle
						r={r}
						className={cn(
							"fill-(--node) dark:fill-(--node-gloss)",
							s.person ? "stroke-orb-1/70" : "stroke-ink-2/60",
							"dark:stroke-none dark:drop-shadow-[0_0_7px_color-mix(in_oklab,var(--node)_55%,transparent)]",
						)}
						strokeWidth={1}
						style={{
							r,
							opacity: quiet && !target ? 0.55 : 1,
							transition: `r 560ms ${EASE}, opacity 300ms`,
						}}
					/>
					{unread > 0 && (
						<circle
							r={2.8}
							className="fill-signal stroke-card dark:fill-signal-2 dark:stroke-background"
							strokeWidth={1.5}
							style={{ cx: dot.cx, cy: dot.cy, opacity: target ? 0 : 1, transition: `cx 520ms ${EASE}, cy 520ms ${EASE}, opacity 200ms` }}
						/>
					)}
				</g>
			</g>
			{(chip || name) && (
				<g
					aria-hidden
					className="entrance"
					style={{ ["--i" as string]: 13 + Math.floor(s.ring / 5) }}
				>
					<g style={{ opacity: target ? 0 : 1, transition: "opacity 200ms" }}>
						{chip && (
							<g transform={`translate(${chip.x - s.x} ${chip.y - s.y})`}>
								<rect
									width={chip.w}
									height={CHIP_H}
									rx={CHIP_H / 2}
									className={cn(
										"fill-sheet stroke-border dark:fill-black/45 dark:stroke-glass-border",
										hovered && "stroke-signal/60 dark:stroke-signal/50",
									)}
									strokeWidth={1}
								/>
								<text
									x={chip.w / 2}
									y={CHIP_H / 2}
									textAnchor="middle"
									dominantBaseline="central"
									className={cn("tabular fill-foreground font-mono text-[10px]", quiet && "fill-ink-2")}
								>
									{s.value}
								</text>
							</g>
						)}
						{name && (
							<text
								x={name.x - s.x}
								y={name.y - s.y}
								textAnchor={name.anchor}
								dominantBaseline="central"
								className={cn(
									"orbit-halo text-[11.5px] transition-colors",
									hovered ? "fill-foreground" : "fill-ink-2",
								)}
							>
								{name.text}
							</text>
						)}
					</g>
				</g>
			)}
		</g>
	);
}

function OrbitTooltip({
	layout,
	senders,
	tipId,
	now,
	vocab,
}: {
	layout: OrbitLayout;
	senders: Map<string, SenderStat>;
	tipId: string | null;
	now: number | null;
	vocab: OrbitVocab;
}) {
	const node = tipId ? layout.senders.find((s) => s.id === tipId) : undefined;
	const stat = tipId ? senders.get(tipId) : undefined;
	if (!node || !stat) return null;
	const W = 236;
	const H = 118;
	const gap = node.slotR + 14;
	const preferRight = node.side === "right";
	let left = preferRight ? node.x + gap : node.x - gap - W;
	if (left + W > layout.width - 6) left = node.x - gap - W;
	if (left < 6) left = Math.min(layout.width - W - 6, node.x + gap);
	const top = clampNum(node.y - H / 2, 6, layout.height - H - 6);
	const week = layout.week;

	return (
		<div
			aria-hidden
			className="glass-thin pointer-events-none absolute z-20 rounded-[18px] px-4 py-3.5 shadow-lift transition-opacity duration-150 starting:opacity-0"
			style={{ left, top, width: W }}
		>
			<p className="truncate font-display text-[15px] leading-tight">{displayName(stat)}</p>
			<p className="mt-0.5 truncate font-mono text-[11px] text-ink-2">{stat.address}</p>
			<div className="mt-2.5 flex items-baseline gap-3">
				<p className="tabular font-display text-[22px] leading-none">{formatCount(node.value)}</p>
				<p className="text-[12px] text-ink-2">
					{week === null ? `${vocab.unit[1]} · ${vocab.window.all}` : `${vocab.unit[1]} in ${vocab.window.week(week)}`}
				</p>
			</div>
			<p className="mt-2 flex items-center gap-2 text-[12px] text-ink-2">
				{stat.unread > 0 ? (
					<span className="inline-flex items-center gap-1.5 text-foreground">
						<span className="size-1.5 rounded-full bg-signal dark:bg-signal-2" />
						{stat.unread} {vocab.flag.label}
					</span>
				) : (
					<span>{vocab.flag.clear}</span>
				)}
				<span aria-hidden>·</span>
				<span className="truncate">
					{now !== null ? vocab.recency(stat, now) : vocab.categoryLabel[stat.category]}
				</span>
			</p>
		</div>
	);
}
