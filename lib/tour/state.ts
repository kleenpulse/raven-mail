"use client";

import { create } from "zustand";
import { toast } from "sonner";
import { parseBlob, reconcile, serializeBlob, stamp, TOUR_STORAGE_KEY } from "./sync";
import { DEFAULT_TOUR_STATE, type TourResponse, type TourState, type TourVoice } from "./types";

/*
 * Durable tour state: instant in memory + localStorage, mirrored to Neon via
 * /api/tour (800ms debounced PUT, last-write-wins reconcile on mount, focus
 * and reconnect). Port of rawstash's settings-provider sync, narrowed to the
 * one record. Nothing here runs until `initTourState(owner)` names the mailbox.
 */

type Store = {
	tour: TourState;
	/** First reconcile finished — the tour may trust `tour` over the defaults. One-way latch. */
	synced: boolean;
};

export const useTourStateStore = create<Store>(() => ({ tour: DEFAULT_TOUR_STATE, synced: false }));

const PUSH_DEBOUNCE_MS = 800;

let owner: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let warnedPushFailure = false;

function writeLocal(state: TourState) {
	if (!owner) return;
	try {
		localStorage.setItem(TOUR_STORAGE_KEY, serializeBlob(owner, state));
	} catch {
		/* storage blocked — this session only */
	}
}

function apply(state: TourState) {
	useTourStateStore.setState({ tour: state });
	writeLocal(state);
}

async function readRemote(): Promise<TourResponse> {
	const res = await fetch("/api/tour", { cache: "no-store" });
	if (!res.ok) throw new Error(`tour ${res.status}`);
	return (await res.json()) as TourResponse;
}

async function push() {
	const snapshot = useTourStateStore.getState().tour;
	if (!owner || !snapshot.updatedAt) return;
	try {
		const res = await fetch("/api/tour", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(snapshot),
		});
		if (!res.ok) throw new Error(`tour ${res.status}`);
		const body = (await res.json()) as TourResponse;
		warnedPushFailure = false;
		// Another device wrote later: its state wins here too.
		const decision = body.data ? reconcile(useTourStateStore.getState().tour, body.data) : null;
		if (decision?.kind === "adopt") apply(decision.state);
	} catch {
		if (!warnedPushFailure) {
			warnedPushFailure = true;
			toast.message("Your tour progress is saved on this device", { description: "Raven will sync it to your account later." });
		}
	}
}

function schedulePush() {
	if (pushTimer) clearTimeout(pushTimer);
	pushTimer = setTimeout(() => {
		pushTimer = null;
		void push();
	}, PUSH_DEBOUNCE_MS);
}

export async function syncTour(): Promise<void> {
	if (!owner) return;
	const local = useTourStateStore.getState().tour;
	let remote: TourResponse;
	try {
		remote = await readRemote();
	} catch {
		// Replica unreachable. A device that has its own record can go on
		// trusting it; a fresh one waits, so a returning user on a new device
		// doesn't get the tour again just because Neon was asleep.
		if (local.updatedAt) useTourStateStore.setState({ synced: true });
		return;
	}
	if (remote.db) {
		const decision = reconcile(local, remote.data);
		if (decision.kind === "adopt") apply(decision.state);
		else if (decision.kind === "push") void push();
	}
	useTourStateStore.setState({ synced: true });
}

let listening = false;

/** Called once by TourMount with the signed-in mailbox's opaque id. */
export function initTourState(nextOwner: string) {
	if (owner !== nextOwner) {
		owner = nextOwner;
		let saved: TourState | null = null;
		try {
			saved = parseBlob(localStorage.getItem(TOUR_STORAGE_KEY), nextOwner);
		} catch {
			/* storage blocked */
		}
		useTourStateStore.setState({ tour: saved ?? DEFAULT_TOUR_STATE, synced: false });
	}
	if (!listening) {
		listening = true;
		window.addEventListener("focus", () => void syncTour());
		window.addEventListener("online", () => void syncTour());
	}
	void syncTour();
}

export function writeTour(patch: Partial<Omit<TourState, "updatedAt">>) {
	apply(stamp(useTourStateStore.getState().tour, patch));
	schedulePush();
}

export function setTourVoice(voice: TourVoice) {
	if (useTourStateStore.getState().tour.voice !== voice) writeTour({ voice });
}

export function getTourState(): TourState {
	return useTourStateStore.getState().tour;
}

export function useTourState(): Store {
	const tour = useTourStateStore((s) => s.tour);
	const synced = useTourStateStore((s) => s.synced);
	return { tour, synced };
}
