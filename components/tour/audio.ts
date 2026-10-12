"use client";

// Tour narration playback. Clips are static pre-generated assets resolved
// through the committed manifest, one set per accent — the app never calls a
// TTS API at runtime. Audio is enhancement, never required: every failure path
// (missing clip, autoplay block, decode error) is swallowed and the typewriter
// falls back to timer pacing.

import { getPref, setPref } from "@/lib/prefs/store";
import { TOUR_VOICES, VOICE_LABELS, type TourVoice } from "@/lib/tour/types";
import { TOUR_AUDIO } from "./tour-audio.manifest";

// Singleton — a step transition cancels the prior clip before starting its
// own; TourMount is mounted once, so module scope is safe.
const currentAudioRef: { audio: HTMLAudioElement | null } = { audio: null };

// Session-scoped failure memory: a clip that errored once is skipped for the
// rest of the session. Cleared on restart/resume.
const failedAudio = new Set<string>();
const prefetched = new Set<string>();

// Mistral clips are noticeably quieter than ElevenLabs (~1.85x gain + 1.1x
// rate to match). Routed through WebAudio only for mistral-provider entries;
// any failure falls back to plain playback.
const MISTRAL_GAIN = 1.85;
const MISTRAL_RATE = 1.1;
let audioCtx: AudioContext | null = null;

export function getStepAudio(
	voice: TourVoice,
	stepId: string,
): { url: string; provider: "elevenlabs" | "mistral" } | null {
	const entry = TOUR_AUDIO[voice]?.[stepId];
	return entry ? { url: entry.file, provider: entry.provider } : null;
}

/** Narration on/off is a per-device setting (Settings → Tour), not part of the synced tour record. */
export function isTtsMuted(): boolean {
	return !getPref("tour.narration");
}

export function setTtsMuted(muted: boolean): void {
	setPref("tour.narration", !muted);
}

export function cancelActiveAudio(): void {
	if (currentAudioRef.audio) {
		try {
			currentAudioRef.audio.pause();
			currentAudioRef.audio.src = "";
		} catch {
			/* noop */
		}
		currentAudioRef.audio = null;
	}
}

/** Restart/resume wipe — failed clips get another chance in a fresh run. */
export function clearAudioSession(): void {
	cancelActiveAudio();
	failedAudio.clear();
}

function applyMistralShim(audio: HTMLAudioElement): void {
	audio.playbackRate = MISTRAL_RATE;
	try {
		audioCtx ??= new AudioContext();
		const source = audioCtx.createMediaElementSource(audio);
		const gain = audioCtx.createGain();
		gain.gain.value = MISTRAL_GAIN;
		source.connect(gain).connect(audioCtx.destination);
		// Context may start suspended pre-gesture; best-effort.
		void audioCtx.resume().catch(() => {});
	} catch {
		// WebAudio unavailable/misbehaving — plain (quieter) playback wins
		// over no playback.
	}
}

function setTtsLoading(loading: boolean): void {
	const btn = document.querySelector<HTMLButtonElement>(".driver-popover.tour-popover .tour-mute-btn");
	if (btn) btn.dataset.ttsLoading = loading ? "true" : "false";
}

/** Start narration for a step. Returns the element (for the typewriter to
 * pace against) or null when muted/missing/failed — never throws. */
export function playStepAudio(voice: TourVoice, stepId: string): HTMLAudioElement | null {
	cancelActiveAudio();
	const key = `${voice}/${stepId}`;
	if (isTtsMuted()) return null;
	if (failedAudio.has(key)) return null;
	const entry = getStepAudio(voice, stepId);
	if (!entry) return null;

	// Fresh element per step: createMediaElementSource is once-per-element,
	// so reusing one element would pin every clip to the first provider's
	// audio graph.
	const audio = new Audio(entry.url);
	audio.preload = "auto";
	if (entry.provider === "mistral") applyMistralShim(audio);
	currentAudioRef.audio = audio;

	setTtsLoading(true);
	const clearLoading = () => setTtsLoading(false);
	audio.addEventListener("canplay", clearLoading, { once: true });
	audio.addEventListener("playing", clearLoading, { once: true });
	audio.addEventListener("ended", clearLoading, { once: true });
	audio.addEventListener(
		"error",
		() => {
			failedAudio.add(key);
			clearLoading();
		},
		{ once: true },
	);

	// Autoplay may be blocked on the very first step (no prior gesture); the
	// typewriter notices the stall and paces on its timer instead.
	void audio.play().catch(() => {
		clearLoading();
	});
	return audio;
}

/** Warm the HTTP cache for the next step's clip (static immutable asset). */
export function prefetchStepAudio(voice: TourVoice, stepId: string | undefined): void {
	if (!stepId) return;
	const key = `${voice}/${stepId}`;
	if (prefetched.has(key) || failedAudio.has(key)) return;
	if (isTtsMuted()) return;
	const entry = getStepAudio(voice, stepId);
	if (!entry) return;
	prefetched.add(key);
	fetch(entry.url).catch(() => {
		prefetched.delete(key);
	});
}

// ------------------------------------------------------------- mute toggle

const ICON_VOLUME_ON =
	'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
	'<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>' +
	'<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>' +
	'<path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>' +
	"</svg>";

const ICON_VOLUME_OFF =
	'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
	'<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>' +
	'<line x1="22" x2="16" y1="9" y2="15"/>' +
	'<line x1="16" x2="22" y1="9" y2="15"/>' +
	"</svg>";

function paintMuteIcon(btn: HTMLButtonElement, muted: boolean): void {
	btn.innerHTML = muted ? ICON_VOLUME_OFF : ICON_VOLUME_ON;
	btn.dataset.muted = muted ? "true" : "false";
	btn.setAttribute("aria-label", muted ? "Turn narration on" : "Turn narration off");
}

/** Speaker toggle in the popover's top-right corner. Muting cancels the live
 * clip; the typewriter loop notices and continues timer-paced. Unmuting
 * replays the current step through `onUnmute`. */
export function ensureMuteToggle(wrapper: HTMLElement, onUnmute: () => void): void {
	let btn = wrapper.querySelector<HTMLButtonElement>(".tour-mute-btn");
	if (!btn) {
		btn = document.createElement("button");
		btn.type = "button";
		btn.className = "tour-mute-btn";
		btn.addEventListener("click", () => {
			const next = !isTtsMuted();
			setTtsMuted(next);
			if (btn) paintMuteIcon(btn, next);
			if (next) cancelActiveAudio();
			else onUnmute();
		});
		wrapper.appendChild(btn);
	}
	paintMuteIcon(btn, isTtsMuted());
}

// ----------------------------------------------------------- accent switch

/** GB/US segmented switch, shown on the welcome step. Picking a voice hands
 * control back to the engine, which replays the step in that accent. */
export function ensureVoiceToggle(
	wrapper: HTMLElement,
	before: Element | null,
	current: TourVoice,
	onPick: (voice: TourVoice) => void,
): void {
	let row = wrapper.querySelector<HTMLElement>(".tour-voice-row");
	if (!row) {
		row = document.createElement("div");
		row.className = "tour-voice-row";
		const label = document.createElement("span");
		label.className = "tour-voice-label";
		label.id = "tour-voice-label";
		label.textContent = "Voice";
		const group = document.createElement("div");
		group.className = "tour-voice-group";
		group.setAttribute("role", "radiogroup");
		group.setAttribute("aria-labelledby", label.id);
		for (const voice of TOUR_VOICES) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "tour-voice-btn";
			btn.dataset.voice = voice;
			btn.setAttribute("role", "radio");
			btn.textContent = VOICE_LABELS[voice];
			btn.addEventListener("click", () => {
				paintVoice(group, voice);
				onPick(voice);
			});
			group.appendChild(btn);
		}
		row.append(label, group);
		wrapper.insertBefore(row, before);
	}
	const group = row.querySelector<HTMLElement>(".tour-voice-group");
	if (group) paintVoice(group, current);
}

function paintVoice(group: HTMLElement, voice: TourVoice): void {
	for (const btn of group.querySelectorAll<HTMLButtonElement>(".tour-voice-btn")) {
		const on = btn.dataset.voice === voice;
		btn.setAttribute("aria-checked", on ? "true" : "false");
		btn.tabIndex = on ? 0 : -1;
	}
}
