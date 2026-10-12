"use client";

// The tour engine — ported from rawstash (itself from ellum-ai). driver.js
// over intro.js: small, TS-native, framework-agnostic, and onPopoverRender
// lets the buttons render with our own styles.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import type { Driver, DriveStep, PopoverDOM } from "driver.js";

import { getTourState, setTourVoice, useTourState, writeTour } from "@/lib/tour/state";
import type { TourState } from "@/lib/tour/types";

import {
	cancelActiveAudio,
	clearAudioSession,
	ensureMuteToggle,
	ensureVoiceToggle,
	playStepAudio,
	prefetchStepAudio,
} from "./audio";
import { TOUR_STEPS, type TourStep } from "./tour.config";
import { runNarratedTypewriter, type TypewriterHandle } from "./typewriter";
import { endTour, setTourStep, startTour, useTourStore } from "./store";

// Tailwind's `md` — below it the rail becomes the bottom tab bar.
const MOBILE_MQ = "(max-width: 767.98px)";

const LABELS = {
	back: "Back",
	skip: "Skip",
	next: "Next",
	done: "Done",
	cancel: "Cancel",
	skipConfirm: "Skip the tour?",
	loadingNextStep: "Loading next step…",
	stillLoading: "Still loading. You can skip ahead.",
	stepOf: (current: number, total: number) => `Step ${current} of ${total}`,
} as const;

// Wait/poll abort token. Flipped true by finishTour so Skip/Done interrupt
// any in-flight poll without leaking the rAF loop.
const waitAbortRef: { aborted: boolean } = { aborted: false };

// Loading escape hatch timer. Cleared whenever advance() starts (cancels a
// stale timer) and in finishTour() / unmount to avoid leaks.
const loaderTimeoutRef: { id: ReturnType<typeof setTimeout> | null } = { id: null };

function clearLoaderTimeout(): void {
	if (loaderTimeoutRef.id !== null) {
		clearTimeout(loaderTimeoutRef.id);
		loaderTimeoutRef.id = null;
	}
}

// Tracks the live popover wrapper so advance() can mutate it into a loading
// state during route navigation (driver.js destroys the wrapper on the next
// highlight, so no manual cleanup is needed).
const currentPopoverRef: { wrapper: HTMLElement | null } = { wrapper: null };

// Live narrated-typewriter loop — cancelled on every step change/teardown so
// a stale rAF loop never paints into a destroyed popover.
const activeTypewriterRef: { handle: TypewriterHandle | null } = { handle: null };

function cancelActiveTypewriter(): void {
	activeTypewriterRef.handle?.cancel();
	activeTypewriterRef.handle = null;
}

// Ring overlay on the highlighted element — position:fixed on body
// so overflow:hidden ancestors and backdrop-filter containing blocks never
// clip it. getBoundingClientRect is viewport px, so Interface Size zoom on the
// app frame needs no correction here.
const activeElementOverlayRef: { el: HTMLDivElement | null; target: HTMLElement | null } = { el: null, target: null };

function removeActiveElementOverlay(): void {
	activeElementOverlayRef.el?.remove();
	activeElementOverlayRef.el = null;
	activeElementOverlayRef.target = null;
}

/** Corner radius the spotlight should follow. Anchors are often bare wrappers
 * around a rounded card, so a square wrapper borrows its only child's radius. */
function radiusOf(el: HTMLElement): number {
	const own = Number.parseFloat(window.getComputedStyle(el).borderTopLeftRadius) || 0;
	if (own > 0 || el.children.length !== 1) return own;
	const child = el.firstElementChild as HTMLElement;
	const a = el.getBoundingClientRect();
	const b = child.getBoundingClientRect();
	const covers = Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2;
	return covers ? Number.parseFloat(window.getComputedStyle(child).borderTopLeftRadius) || 0 : 0;
}

/** Pill/circle radii (9999px) clamp to a true half-height, so the SVG arc stays sane. */
function stageRadiusFor(el: HTMLElement): number {
	const rect = el.getBoundingClientRect();
	const pad = DRIVER_OPTIONS.stagePadding;
	return Math.min(radiusOf(el), Math.min(rect.width, rect.height) / 2) + pad;
}

function placeElementOverlay(): void {
	const { el: overlay, target } = activeElementOverlayRef;
	if (!overlay || !target) return;
	const rect = target.getBoundingClientRect();
	overlay.style.top = `${rect.top}px`;
	overlay.style.left = `${rect.left}px`;
	overlay.style.width = `${rect.width}px`;
	overlay.style.height = `${rect.height}px`;
	overlay.style.borderRadius = `${radiusOf(target)}px`;
}

function ensureActiveElementOverlay(element: HTMLElement | null): void {
	removeActiveElementOverlay();
	if (!element) return;

	const overlay = document.createElement("div");
	overlay.className = "tour-element-overlay";
	document.body.appendChild(overlay);
	activeElementOverlayRef.el = overlay;
	activeElementOverlayRef.target = element;

	// Double-RAF: first tick lets driver.js finish scroll-into-view, second
	// tick reads the final settled rect.
	requestAnimationFrame(() => requestAnimationFrame(placeElementOverlay));
}

function showTransitionLoader(loadingText: string): void {
	const wrapper = currentPopoverRef.wrapper;
	if (!wrapper || !document.body.contains(wrapper)) return;

	cancelActiveTypewriter();
	wrapper.dataset.tourLoading = "true";

	const desc = wrapper.querySelector<HTMLElement>(".driver-popover-description");
	if (desc) {
		desc.innerHTML =
			'<span class="tour-loading" role="status">' +
			'<span class="tour-loading-spinner" aria-hidden="true"></span>' +
			'<span class="tour-loading-text"></span>' +
			"</span>";
		const textEl = desc.querySelector<HTMLElement>(".tour-loading-text");
		if (textEl) textEl.textContent = loadingText;
	}
}

function isMobileViewport(): boolean {
	return typeof window !== "undefined" && window.matchMedia(MOBILE_MQ).matches;
}

function isVisible(el: Element | null): el is HTMLElement {
	if (!el || !(el instanceof HTMLElement)) return false;
	const style = window.getComputedStyle(el);
	if (style.visibility === "hidden" || style.display === "none") return false;
	const rect = el.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0;
}

/** First visible match — one anchor id lives on both the rail and the mobile tab bar. */
function firstVisible(selector: string): HTMLElement | null {
	for (const el of document.querySelectorAll(selector)) if (isVisible(el)) return el;
	return null;
}

function pollUntilVisibleWithTimeout(selector: string, timeoutMs: number): Promise<HTMLElement | null> {
	return new Promise((resolve) => {
		let done = false;
		const timer = setTimeout(() => {
			done = true;
			resolve(null);
		}, timeoutMs);
		const tick = () => {
			if (done) return;
			if (waitAbortRef.aborted) {
				clearTimeout(timer);
				done = true;
				resolve(null);
				return;
			}
			const el = firstVisible(selector);
			if (el) {
				clearTimeout(timer);
				done = true;
				resolve(el);
				return;
			}
			requestAnimationFrame(tick);
		};
		tick();
	});
}

// Root route '/' must match exactly — every pathname startsWith('/'), so a
// startsWith check would treat any page as "already on /" and never navigate.
function pathMatches(pathname: string, targetPath: string): boolean {
	if (targetPath === "/") return pathname === "/";
	return pathname === targetPath || pathname.startsWith(`${targetPath}/`);
}

function waitForRoute(href: string): Promise<void> {
	const qIdx = href.indexOf("?");
	const path = qIdx === -1 ? href : href.slice(0, qIdx);
	const expectedParams = qIdx !== -1 ? new URLSearchParams(href.slice(qIdx + 1)) : null;

	return new Promise((resolve) => {
		const tick = () => {
			if (waitAbortRef.aborted) return resolve();
			if (!pathMatches(window.location.pathname, path)) {
				requestAnimationFrame(tick);
				return;
			}
			if (expectedParams) {
				const current = new URLSearchParams(window.location.search);
				const allMatch = [...expectedParams.entries()].every(([k, v]) => current.get(k) === v);
				if (!allMatch) {
					requestAnimationFrame(tick);
					return;
				}
			}
			resolve();
		};
		tick();
	});
}

async function tryLoadDriver(): Promise<typeof import("driver.js") | null> {
	try {
		return await import("driver.js");
	} catch (err) {
		console.warn("[tour] driver.js failed to load", err);
		return null;
	}
}

const DRIVER_OPTIONS = {
	allowClose: false,
	overlayOpacity: 0.55,
	stagePadding: 6,
	stageRadius: 0,
	popoverOffset: 16,
	popoverClass: "tour-popover",
	disableActiveInteraction: true,
	// Raven scrolls inside panes (body never scrolls). Native scrollIntoView
	// walks scrollable ancestors correctly; driver's animated scroll assumes
	// window and must stay off.
	smoothScroll: false,
} as const;

function ensureProgressStrip(popover: PopoverDOM, stepIdx: number, totalSteps: number): void {
	const pct = ((stepIdx + 1) / totalSteps) * 100;

	let strip = popover.wrapper.querySelector<HTMLElement>(".tour-progress-strip");
	if (!strip) {
		strip = document.createElement("div");
		strip.className = "tour-progress-strip";
		strip.innerHTML =
			'<div class="tour-progress-row"><span class="tour-progress-label"></span></div>' +
			'<div class="tour-progress-track"><div class="tour-progress-fill"></div></div>';
		// Before the footer, so the bar sits between description and buttons.
		popover.wrapper.insertBefore(strip, popover.footer);
	}

	const label = strip.querySelector<HTMLElement>(".tour-progress-label");
	if (label) label.textContent = LABELS.stepOf(stepIdx + 1, totalSteps);

	const fill = strip.querySelector<HTMLElement>(".tour-progress-fill");
	if (fill) fill.style.setProperty("--tour-rest", `${100 - pct}%`);
}

function buildPopoverButtons(opts: {
	isLast: boolean;
	onNext: () => void;
	onSkip: () => void;
	onBack?: () => void;
}): HTMLElement {
	const wrapper = document.createElement("div");
	wrapper.className = "tour-popover-actions";

	// Two render modes: normal actions, and inline skip-confirm.
	const renderNormal = () => {
		wrapper.innerHTML = "";

		if (opts.onBack) {
			const backBtn = document.createElement("button");
			backBtn.type = "button";
			backBtn.textContent = LABELS.back;
			backBtn.className = "tour-btn tour-btn-outline";
			backBtn.addEventListener("click", opts.onBack);
			wrapper.appendChild(backBtn);
		}

		const skipBtn = document.createElement("button");
		skipBtn.type = "button";
		skipBtn.textContent = LABELS.skip;
		skipBtn.className = "tour-btn tour-btn-ghost";
		skipBtn.addEventListener("click", renderConfirm);
		wrapper.appendChild(skipBtn);

		const nextBtn = document.createElement("button");
		nextBtn.type = "button";
		nextBtn.textContent = opts.isLast ? LABELS.done : LABELS.next;
		nextBtn.className = "tour-btn tour-btn-primary";
		nextBtn.addEventListener("click", opts.onNext);
		wrapper.appendChild(nextBtn);
	};

	const renderConfirm = () => {
		wrapper.innerHTML = "";

		const prompt = document.createElement("span");
		prompt.className = "tour-confirm-prompt";
		prompt.textContent = LABELS.skipConfirm;
		wrapper.appendChild(prompt);

		const cancelBtn = document.createElement("button");
		cancelBtn.type = "button";
		cancelBtn.textContent = LABELS.cancel;
		cancelBtn.className = "tour-btn tour-btn-ghost";
		cancelBtn.addEventListener("click", renderNormal);
		wrapper.appendChild(cancelBtn);

		const confirmBtn = document.createElement("button");
		confirmBtn.type = "button";
		confirmBtn.textContent = LABELS.skip;
		confirmBtn.className = "tour-btn tour-btn-destructive";
		confirmBtn.addEventListener("click", opts.onSkip);
		wrapper.appendChild(confirmBtn);
	};

	renderNormal();
	return wrapper;
}

function destroyDriver(drv: Driver | null): void {
	if (!drv) return;
	try {
		drv.destroy();
	} catch {
		/* noop */
	}
}

export function useTour() {
	const router = useRouter();
	const { tour, synced } = useTourState();
	const { isActive, restartToken, resumeToken } = useTourStore();

	const lastRestartTokenRef = useRef(restartToken);
	const lastResumeTokenRef = useRef(resumeToken);

	const driverRef = useRef<Driver | null>(null);
	const initializedRef = useRef(false);
	const advancingRef = useRef(false);
	// Set by the RESUME effect to the step a skipped tour resumes at. While
	// the anchor step is showing, advance() preserves persisted `skipped:true`
	// so a mid-resume reload doesn't auto-start. Cleared once the user moves
	// off it.
	const resumeAnchorRef = useRef<number | null>(null);

	const writeStatus = useCallback((partial: Partial<Omit<TourState, "updatedAt" | "voice">>) => writeTour(partial), []);

	const finishTour = useCallback(
		(kind: "completed" | "skipped") => {
			// Break any in-flight poll / route wait so the rAF loop resolves.
			waitAbortRef.aborted = true;
			clearLoaderTimeout();
			cancelActiveTypewriter();
			cancelActiveAudio();
			removeActiveElementOverlay();
			destroyDriver(driverRef.current);
			driverRef.current = null;
			endTour();
			writeStatus({ completed: kind === "completed", skipped: kind === "skipped" });
		},
		[writeStatus],
	);

	const advance = useCallback(
		async (to: number) => {
			if (advancingRef.current) return;
			advancingRef.current = true;
			waitAbortRef.aborted = false;
			clearLoaderTimeout();
			try {
				const step: TourStep | undefined = TOUR_STEPS[to];
				if (!step) {
					finishTour("completed");
					return;
				}
				const isLast = to === TOUR_STEPS.length - 1;

				if (step.route) {
					const targetPath = step.route.split("?")[0]!;
					if (!pathMatches(window.location.pathname, targetPath)) {
						// Visual feedback while the page loads — the popover gets
						// replaced when driver.highlight() runs below.
						showTransitionLoader(LABELS.loadingNextStep);

						// Escape hatch: still loading after 4s → re-enable Skip +
						// Next. Next flips waitAbortRef → the poll resolves null →
						// the null-element path advances. Skip destroys the driver →
						// auto-advance is blocked by the driverRef guard.
						const capturedWrapper = currentPopoverRef.wrapper;
						loaderTimeoutRef.id = setTimeout(() => {
							loaderTimeoutRef.id = null;
							if (!capturedWrapper || !document.body.contains(capturedWrapper)) return;
							if (capturedWrapper.dataset.tourLoading !== "true") return;

							const loadingText = capturedWrapper.querySelector<HTMLElement>(".tour-loading-text");
							if (loadingText) loadingText.textContent = LABELS.stillLoading;

							delete capturedWrapper.dataset.tourLoading;

							const footer = capturedWrapper.querySelector<HTMLElement>(".driver-popover-footer");
							if (!footer) return;
							footer.innerHTML = "";
							footer.style.display = "flex";
							footer.appendChild(
								buildPopoverButtons({
									isLast,
									onNext: () => {
										waitAbortRef.aborted = true;
									},
									onSkip: () => finishTour("skipped"),
								}),
							);
						}, 4000);

						router.push(step.route);
						await waitForRoute(step.route);
					}
				}

				const mobile = isMobileViewport();
				const selector = step.selector ?? null;

				let element: HTMLElement | null = null;
				if (selector) {
					// Bounded poll — a target that never shows (wrong viewport,
					// empty mailbox, slow load) skips gracefully.
					element = await pollUntilVisibleWithTimeout(selector, step.pollTimeoutMs ?? 8000);
					if (!element) {
						console.warn(`[tour] step "${step.id}": target ${selector} not visible — skipping`);
						advancingRef.current = false;
						void advance(to + 1);
						return;
					}
				}

				const drv = driverRef.current;
				if (!drv) {
					advancingRef.current = false;
					return;
				}

				const side = (mobile && step.mobileSide) || step.side;
				const popoverConfig: DriveStep["popover"] = {
					title: step.title,
					description: step.body,
					// "over" is our own value for "let driver place it" — it
					// never reaches the library.
					side: side === "over" ? undefined : (side ?? "bottom"),
					showButtons: [],
					onPopoverRender: (popover: PopoverDOM) => {
						// Capture wrapper so advance() can mutate it into the loading
						// state on the next route transition.
						currentPopoverRef.wrapper = popover.wrapper;

						ensureActiveElementOverlay(element);

						// Narration + typewriter: the pre-gen clip paces the reveal;
						// muted/missing/blocked audio → timer pacing.
						const narrate = () => {
							cancelActiveTypewriter();
							const voice = getTourState().voice;
							const audio = step.tts ? playStepAudio(voice, step.id) : null;
							if (step.typewriter) {
								activeTypewriterRef.handle = runNarratedTypewriter(popover.description, step.body, audio);
							}
						};

						ensureMuteToggle(popover.wrapper, narrate);

						if (step.voicePicker) {
							ensureVoiceToggle(popover.wrapper, popover.footer, getTourState().voice, (voice) => {
								setTourVoice(voice);
								narrate();
								const nextStep = TOUR_STEPS[to + 1];
								if (nextStep?.tts) prefetchStepAudio(voice, nextStep.id);
							});
						}

						ensureProgressStrip(popover, to, TOUR_STEPS.length);

						narrate();

						// Warm the next step's clip so the click→play gap is small.
						const nextStep = TOUR_STEPS[to + 1];
						if (nextStep?.tts) prefetchStepAudio(getTourState().voice, nextStep.id);

						// Action row — native driver buttons hidden via CSS.
						const buttons = buildPopoverButtons({
							isLast,
							onNext: () => {
								if (isLast) finishTour("completed");
								else void advance(to + 1);
							},
							onSkip: () => finishTour("skipped"),
							onBack: to > 0 ? () => void advance(to - 1) : undefined,
						});
						popover.footer.innerHTML = "";
						popover.footer.style.display = "flex";
						popover.footer.appendChild(buttons);
					},
				};

				// Elementless steps: zero the stage padding — driver cuts its
				// hole around a 0×0 dummy at viewport center, and padding
				// leaves a floating square of un-dimmed page.
				drv.setConfig({
					...DRIVER_OPTIONS,
					stagePadding: element ? DRIVER_OPTIONS.stagePadding : 0,
					// Concentric with the element's own corners, padding included.
					stageRadius: element ? stageRadiusFor(element) : 0,
				});

				if (element) {
					drv.highlight({ element, popover: popoverConfig });
				} else {
					// Centered popover. Omit `element` entirely so driver.js uses
					// its internal dummy element. Passing element:'body' would let
					// `.driver-no-interaction *` freeze the Next/Skip buttons.
					drv.highlight({ popover: { ...popoverConfig, side: undefined } });
				}

				setTourStep(to);
				if (resumeAnchorRef.current === to) {
					// Resumed (anchor) step: persist progress but keep the existing
					// terminal flag (skipped:true) so abandoning here won't
					// auto-start next session. Cleared once the user advances off
					// this step (else branch).
					writeStatus({ lastStep: to });
				} else {
					resumeAnchorRef.current = null;
					writeStatus({ lastStep: to, completed: false, skipped: false });
				}
			} finally {
				advancingRef.current = false;
			}
		},
		[router, finishTour, writeStatus],
	);

	// AUTO-START: gate on the `synced` latch — state inits to the defaults,
	// so acting pre-sync would flash the tour for every returning user.
	useEffect(() => {
		if (!synced) return;
		if (initializedRef.current) return;
		if (isActive) return;

		if (tour.completed || tour.skipped) {
			initializedRef.current = true;
			return;
		}

		let cancelled = false;
		void (async () => {
			const mod = await tryLoadDriver();
			if (cancelled || !mod) return;
			try {
				const drv = mod.driver(DRIVER_OPTIONS);
				driverRef.current = drv;
				initializedRef.current = true;
				// Clamp to the last valid index — the step list can shrink
				// between releases, stranding a persisted lastStep past the end.
				const startAt = Math.min(tour.lastStep, TOUR_STEPS.length - 1);
				startTour(startAt);
				void advance(startAt);
			} catch (err) {
				console.warn("[tour] init failed", err);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [synced, tour, isActive, advance]);

	// RESTART: bumped via requestTourRestart(). Tear down any in-flight tour,
	// then write a non-terminal status — AUTO-START re-fires off the change.
	useEffect(() => {
		if (lastRestartTokenRef.current === restartToken) return;
		lastRestartTokenRef.current = restartToken;

		waitAbortRef.aborted = true;
		clearLoaderTimeout();
		cancelActiveTypewriter();
		clearAudioSession();
		removeActiveElementOverlay();
		destroyDriver(driverRef.current);
		driverRef.current = null;

		endTour();
		initializedRef.current = false;
		resumeAnchorRef.current = null;
		writeStatus({ completed: false, skipped: false, lastStep: 0 });
	}, [restartToken, writeStatus]);

	// RESUME: bumped via requestTourResume() (skipped-only). Re-enters a
	// skipped tour at the persisted lastStep WITHOUT resetting status —
	// `skipped:true` stays until the user moves off the anchor step. Can't
	// lean on AUTO-START: that gates on terminal status.
	useEffect(() => {
		if (lastResumeTokenRef.current === resumeToken) return;
		lastResumeTokenRef.current = resumeToken;

		const status = getTourState();
		if (!status.skipped) return;
		const startAt = status.lastStep;
		if (startAt < 0 || startAt >= TOUR_STEPS.length) return;

		waitAbortRef.aborted = true;
		clearLoaderTimeout();
		cancelActiveTypewriter();
		clearAudioSession();
		removeActiveElementOverlay();
		destroyDriver(driverRef.current);
		driverRef.current = null;

		let cancelled = false;
		void (async () => {
			const mod = await tryLoadDriver();
			if (cancelled || !mod) return;
			try {
				const drv = mod.driver(DRIVER_OPTIONS);
				driverRef.current = drv;
				initializedRef.current = true;
				resumeAnchorRef.current = startAt;
				startTour(startAt);
				void advance(startAt);
			} catch (err) {
				console.warn("[tour] resume failed", err);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [resumeToken, advance]);

	// Raven scrolls inside panes, and driver.js only re-positions on WINDOW
	// scroll/resize — an inner scroll would strand the cutout. Scroll doesn't
	// bubble, so listen in the capture phase; rAF-throttled.
	useEffect(() => {
		if (!isActive) return;
		let raf = 0;
		const onScroll = () => {
			if (raf) return;
			raf = requestAnimationFrame(() => {
				raf = 0;
				driverRef.current?.refresh();
				placeElementOverlay();
			});
		};
		document.addEventListener("scroll", onScroll, { capture: true, passive: true });
		window.addEventListener("resize", onScroll, { passive: true });
		return () => {
			document.removeEventListener("scroll", onScroll, { capture: true });
			window.removeEventListener("resize", onScroll);
			if (raf) cancelAnimationFrame(raf);
		};
	}, [isActive]);

	// CLEANUP on unmount.
	useEffect(() => {
		return () => {
			clearLoaderTimeout();
			cancelActiveTypewriter();
			cancelActiveAudio();
			removeActiveElementOverlay();
			destroyDriver(driverRef.current);
			driverRef.current = null;
		};
	}, []);
}
