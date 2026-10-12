"use client";

// Narrated typewriter — ported from rawstash (itself from companion-tts's RevealText):
// text reveals in sync with narration by mapping audio.currentTime/duration
// linearly onto the character count. The three load-bearing details from the
// source: the +1 char lead (text lands just before it's heard), the
// monotonic latch (frac jitter can't un-reveal), and memoizing on the
// integer edge (frames where it hasn't moved do zero DOM work).
//
// No per-char timestamps exist for the pre-gen clips, so the linear map is
// what keeps this provider-agnostic — ElevenLabs and Mistral mp3s pace
// identically (audio is enhancement; muted/missing/stalled clips fall back to
// a ~20ms/char timer that continues from the current latch).

/** How many of `total` units are visible at playback fraction `frac`.
 * Verbatim from companion-tts (src/shared/format.ts). */
export function revealEdge(frac: number, total: number, ended: boolean): number {
	if (ended) return total;
	return frac > 0 ? Math.min(Math.floor(frac * total) + 1, total) : 0;
}

const TIMER_MS_PER_CHAR = 20;
// Audio that has neither started nor advanced for this long is treated as
// dead (autoplay block, mute cancel, stall) → timer pacing takes over.
const AUDIO_STALL_MS = 1200;

export type TypewriterHandle = { cancel: () => void };

export function runNarratedTypewriter(
	descriptionEl: HTMLElement,
	text: string,
	audio: HTMLAudioElement | null,
): TypewriterHandle {
	// Array.from is surrogate-pair safe — emoji never split mid-glyph.
	const units = Array.from(text);
	const total = units.length;

	// Spans reserve their full layout up front; only opacity flips, so the
	// popover never reflows as text reveals.
	descriptionEl.textContent = "";
	const frag = document.createDocumentFragment();
	const spans: HTMLSpanElement[] = [];
	for (const ch of units) {
		const span = document.createElement("span");
		span.className = "tour-char";
		span.textContent = ch;
		spans.push(span);
		frag.appendChild(span);
	}
	descriptionEl.appendChild(frag);

	// Raven's own Reduce Motion setting counts as much as the OS one.
	if (
		window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
		document.documentElement.dataset.motion === "reduce"
	) {
		for (const s of spans) s.classList.add("is-shown");
		return { cancel: () => {} };
	}

	let shown = 0;
	let raf = 0;
	let cancelled = false;
	let mode: "audio" | "timer" = audio ? "audio" : "timer";
	let timerStart = performance.now();
	let timerBase = 0;
	let lastAdvanceAt = performance.now();

	const switchToTimer = (now: number) => {
		mode = "timer";
		timerStart = now;
		timerBase = shown; // continue from the latch — never jump back
	};

	const tick = (now: number) => {
		if (cancelled) return;

		let edge = shown;
		if (mode === "audio" && audio) {
			if (audio.error) {
				switchToTimer(now);
			} else if (audio.ended) {
				edge = total;
			} else if (
				audio.currentTime > 0 &&
				Number.isFinite(audio.duration) &&
				audio.duration > 0
			) {
				edge = revealEdge(audio.currentTime / audio.duration, total, false);
			}
			// Stall detector: covers autoplay block (never starts), mute
			// (cancelActiveAudio pauses + clears src) and network stalls.
			if (
				mode === "audio" &&
				edge <= shown &&
				audio.paused &&
				now - lastAdvanceAt > AUDIO_STALL_MS
			) {
				switchToTimer(now);
			}
		}
		if (mode === "timer") {
			edge = Math.min(
				total,
				timerBase + Math.floor((now - timerStart) / TIMER_MS_PER_CHAR),
			);
		}

		// Monotonic latch + integer-edge memo: repaint only the delta.
		if (edge > shown) {
			for (let i = shown; i < edge; i++) spans[i].classList.add("is-shown");
			shown = edge;
			lastAdvanceAt = now;
		}

		if (shown >= total) return; // done — spans stay revealed
		raf = requestAnimationFrame(tick);
	};

	raf = requestAnimationFrame(tick);

	return {
		cancel: () => {
			cancelled = true;
			if (raf) cancelAnimationFrame(raf);
		},
	};
}
