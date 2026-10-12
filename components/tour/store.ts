"use client";

import { useSyncExternalStore } from "react";

// Transient tour session state as a module-level store, not React component
// state: the engine outlives page swaps, so page-local state would strand on
// navigation. Nothing here persists; durable status lives in lib/tour/state.

export type TourSessionState = {
	isActive: boolean;
	currentStep: number;
	// Monotonic counters — bumped by request* actions to trigger the matching
	// effect inside useTour(). Transient signals, never persisted.
	restartToken: number;
	resumeToken: number;
};

const INITIAL: TourSessionState = {
	isActive: false,
	currentStep: 0,
	restartToken: 0,
	resumeToken: 0,
};

let state: TourSessionState = INITIAL;
const listeners = new Set<() => void>();

function emit(next: TourSessionState): void {
	state = next;
	for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

const getSnapshot = () => state;
// SSR renders the inert initial state; the tour only ever starts client-side.
const getServerSnapshot = () => INITIAL;

export function useTourStore(): TourSessionState {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function startTour(atStep: number): void {
	emit({ ...state, isActive: true, currentStep: atStep });
}

export function endTour(): void {
	emit({ ...state, isActive: false });
}

export function setTourStep(n: number): void {
	emit({ ...state, currentStep: n });
}

/** "Take the tour" — resets status to non-terminal and re-fires the
 * AUTO-START effect. */
export function requestTourRestart(): void {
	emit({ ...state, restartToken: state.restartToken + 1 });
}

/** "Resume tour" (skipped-only) — re-enters at lastStep without clearing
 * `skipped` until the user moves off the anchor step. */
export function requestTourResume(): void {
	emit({ ...state, resumeToken: state.resumeToken + 1 });
}
