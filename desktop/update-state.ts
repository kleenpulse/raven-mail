import type { UpdateAction, UpdateCheck, UpdateState } from "./bridge";

/*
 * What the updater's events mean for the pill in the page. Pure, so the
 * rules are tested without electron-updater.
 */

export const NO_UPDATE: UpdateState = { kind: "none" };

export type UpdateEvent =
	| { type: "available"; version: string }
	| { type: "progress"; percent: number }
	| { type: "downloaded"; version: string }
	| { type: "error" };

/**
 * The next state, or the same object when nothing the page shows changed
 * (progress only moves in whole percents), so main can skip sending it.
 */
export function nextUpdateState(state: UpdateState, event: UpdateEvent, selfInstall: boolean): UpdateState {
	switch (event.type) {
		case "available":
			// A re-check of the ready version keeps it ready. A newer version replaces it: electron-updater
			// deletes the ready installer when the newer download starts, so restarting would install nothing.
			if (state.kind === "ready" && state.version === event.version) return state;
			if (!selfInstall) return state.kind === "available" && state.version === event.version ? state : { kind: "available", version: event.version };
			return state.kind === "downloading" && state.version === event.version ? state : { kind: "downloading", version: event.version, percent: 0 };
		case "progress": {
			if (state.kind !== "downloading") return state;
			const percent = Math.min(100, Math.max(0, Math.floor(Number.isFinite(event.percent) ? event.percent : 0)));
			return percent === state.percent ? state : { ...state, percent };
		}
		case "downloaded":
			return state.kind === "ready" && state.version === event.version ? state : { kind: "ready", version: event.version };
		case "error":
			// A failed download hides the pill; the next check starts it again. A ready update stays.
			return state.kind === "downloading" ? NO_UPDATE : state;
	}
}

/**
 * What a check by hand found. `ready`: an update was already downloaded, so
 * nothing was checked. `no-feed`: the latest release has no update files.
 */
export type CheckOutcome =
	| { kind: "ready"; version: string }
	| { kind: "found"; version: string }
	| { kind: "current" }
	| { kind: "no-feed" }
	| { kind: "failed" };

/** The page's answer to a check it asked for. The version and the progress reach it with the state. */
export function checkAnswer(outcome: CheckOutcome): UpdateCheck {
	if (outcome.kind === "ready" || outcome.kind === "found") return "found";
	return outcome.kind === "failed" ? "failed" : "current";
}

/** Whether the page may ask for `action` now: restart only once ready, the release page only when that's the way to update. */
export function updateActionAllowed(state: UpdateState, action: UpdateAction): boolean {
	return action === "restart" ? state.kind === "ready" : state.kind === "available";
}

/** A system notification for this state, for when the window can't show the pill. Null when there's nothing to say. */
export function updateNotice(state: UpdateState): { title: string; body: string } | null {
	if (state.kind === "ready") return { title: `Raven ${state.version} is ready.`, body: "Click to restart and update." };
	if (state.kind === "available") return { title: `Raven ${state.version} is out.`, body: "Click to open the download page." };
	return null;
}

/** The tray's update item for this state, or null. */
export function updateMenuItem(state: UpdateState): { label: string; action: UpdateAction } | null {
	if (state.kind === "ready") return { label: `Restart to update to ${state.version}`, action: "restart" };
	if (state.kind === "available") return { label: `Download Raven ${state.version}…`, action: "open-release" };
	return null;
}
