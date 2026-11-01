"use client";

import * as React from "react";
import { ArrowUpRight, RotateCw } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { ravenDesktop, type DesktopUpdateState } from "@/lib/desktop/bridge";
import { cn } from "@/lib/utils";

const NONE: DesktopUpdateState = { kind: "none" };

/** The desktop app's update state; always "none" on the web. */
export function useDesktopUpdate(): DesktopUpdateState {
	const [state, setState] = React.useState<DesktopUpdateState>(NONE);
	React.useEffect(() => {
		const update = ravenDesktop()?.update;
		if (!update) return;
		let live = true;
		let pushed = false;
		const off = update.onState((next) => {
			pushed = true;
			if (live) setState(next);
		});
		// A push that lands first is newer than this answer.
		update
			.state()
			.then((now) => {
				if (live && !pushed) setState(now);
			})
			.catch(() => {});
		return () => {
			live = false;
			off();
		};
	}, []);
	return state;
}

const PILL =
	"flex h-9 shrink-0 animate-rise-in items-center gap-1.5 rounded-pill px-2.5 text-[12px] font-medium ring-1 outline-none sm:px-3";

function ProgressRing({ percent }: { percent: number }) {
	const r = 6;
	const length = 2 * Math.PI * r;
	return (
		<svg aria-hidden viewBox="0 0 16 16" className="size-4 -rotate-90">
			<circle cx="8" cy="8" r={r} fill="none" strokeWidth="2" className="stroke-border dark:stroke-glass-border" />
			<circle
				cx="8"
				cy="8"
				r={r}
				fill="none"
				strokeWidth="2"
				strokeLinecap="round"
				strokeDasharray={length}
				strokeDashoffset={length * (1 - percent / 100)}
				className="stroke-current transition-[stroke-dashoffset] duration-300"
			/>
		</svg>
	);
}

/**
 * VS Code-style update pill for the top bars, desktop app only: progress
 * while an update downloads, then "Restart to update". Builds that can't
 * install updates themselves link to the release page instead.
 */
export function UpdatePill({ className }: { className?: string }) {
	const state = useDesktopUpdate();
	if (state.kind === "none") return null;
	const act = (action: "restart" | "open-release") => ravenDesktop()?.update.act(action);

	if (state.kind === "downloading") {
		return (
			<div
				role="status"
				aria-label={`Downloading Raven ${state.version}, ${state.percent}%`}
				className={cn(PILL, "bg-card-nested text-ink-2 ring-border dark:ring-glass-border", className)}
			>
				<ProgressRing percent={state.percent} />
				<span className="hidden tabular-nums sm:inline">Updating {state.percent}%</span>
			</div>
		);
	}

	if (state.kind === "ready") {
		return (
			<Tip
				label={`Raven ${state.version} is ready`}
				render={
					<button
						type="button"
						onClick={() => act("restart")}
						aria-label={`Restart to update to Raven ${state.version}`}
						className={cn(
							PILL,
							"group/update bg-inverse text-inverse-foreground ring-inverse transition-[box-shadow,transform] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] dark:bg-signal dark:text-primary-foreground dark:ring-signal",
							className,
						)}
					/>
				}
			>
				<RotateCw aria-hidden className="size-4 transition-transform duration-500 group-hover/update:rotate-180" />
				<span className="hidden sm:inline">Restart to update</span>
			</Tip>
		);
	}

	return (
		<Tip
			label="Open the download page"
			render={
				<button
					type="button"
					onClick={() => act("open-release")}
					aria-label={`Raven ${state.version} is out. Open the download page`}
					className={cn(
						PILL,
						"bg-card-nested text-foreground ring-border transition-[box-shadow,transform] hover:ring-foreground/20 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] dark:ring-glass-border",
						className,
					)}
				/>
			}
		>
			<ArrowUpRight aria-hidden className="size-4" />
			<span className="hidden sm:inline">Raven {state.version} is out</span>
		</Tip>
	);
}
