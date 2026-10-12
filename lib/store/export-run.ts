"use client";

import { create } from "zustand";
import { logExportAction } from "@/lib/actions/integrations";
import { ApiError, readApiError, toApiError } from "@/lib/api-error";
import { exportFileName } from "@/lib/integrations/export/mbox";
import { advance, startProgress, type ExportProgress } from "@/lib/integrations/export/progress";
import type { ExportPlan, ExportRange } from "@/lib/integrations/types";

/*
 * The mailbox export runs outside React: pages unmount on navigation, the run
 * must not. Chunks are whole messages, so whatever has been written is always a
 * valid mbox — pausing, failing or cancelling never leaves a torn file.
 */

export type ExportPhase = "idle" | "planning" | "running" | "paused" | "saving" | "done" | "stopped";
export type ExportFailure = { code: string; message: string; hint?: string; retryable: boolean };

type ExportState = {
	phase: ExportPhase;
	folder: string | null;
	range: ExportRange | null;
	fileName: string | null;
	sink: "disk" | "memory" | null;
	plan: ExportPlan | null;
	progress: ExportProgress | null;
	/** Why we're paused: a failure after retries, or the user pressed Pause. */
	error: ExportFailure | null;
	pausedByUser: boolean;
	/** One-line result once the run ends. */
	outcome: string | null;
};

const INITIAL: ExportState = {
	phase: "idle",
	folder: null,
	range: null,
	fileName: null,
	sink: null,
	plan: null,
	progress: null,
	error: null,
	pausedByUser: false,
	outcome: null,
};

export const useExportRun = create<ExportState>()(() => INITIAL);

const set = (patch: Partial<ExportState>) => useExportRun.setState(patch);
const get = () => useExportRun.getState();

/* ── Sinks ───────────────────────────────────────────────────────────────── */

type Sink = { kind: "disk" | "memory"; write(bytes: Uint8Array): Promise<void>; close(): Promise<void>; discard(): Promise<void> };

type SaveHandle = { createWritable(): Promise<{ write(b: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> };
type SavePicker = (opts: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle>;

async function diskSink(handle: SaveHandle): Promise<Sink> {
	const writable = await handle.createWritable();
	return { kind: "disk", write: (b) => writable.write(b), close: () => writable.close(), discard: () => writable.abort() };
}

function memorySink(fileName: string): Sink {
	let parts: Uint8Array[] = [];
	return {
		kind: "memory",
		write: async (b) => void parts.push(b),
		close: async () => {
			const url = URL.createObjectURL(new Blob(parts as BlobPart[], { type: "application/mbox" }));
			const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
			document.body.append(a);
			a.click();
			a.remove();
			parts = [];
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
		},
		discard: async () => void (parts = []),
	};
}

/** Chromium streams straight to disk; elsewhere the file builds up in memory. */
export function canStreamToDisk(): boolean {
	return typeof window !== "undefined" && typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function";
}

/* ── Runner ──────────────────────────────────────────────────────────────── */

let sink: Sink | null = null;
let controller: AbortController | null = null;
let chunkIndex = 0;

const FATAL = new Set(["export_changed", "folder_missing", "invalid_request", "unauthorized", "export_too_large"]);
const RETRY_DELAYS = [1_000, 3_000];

function guardUnload(e: BeforeUnloadEvent) {
	e.preventDefault();
}

function holdPage(on: boolean) {
	if (on) window.addEventListener("beforeunload", guardUnload);
	else window.removeEventListener("beforeunload", guardUnload);
}

function failure(e: ApiError): ExportFailure {
	return { code: e.code, message: e.message, hint: e.hint, retryable: !FATAL.has(e.code) };
}

async function fetchChunk(plan: ExportPlan, index: number, signal: AbortSignal) {
	const chunk = plan.chunks[index]!;
	const started = performance.now();
	const res = await fetch("/api/integrations/export/chunk", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ folder: plan.folder, uidValidity: plan.uidValidity, uids: chunk.uids }),
		signal,
	});
	if (res.status === 401) {
		window.location.replace("/login");
		throw new ApiError("Your session expired.", { status: 401, code: "unauthorized" });
	}
	if (!res.ok) throw await readApiError(res);
	const meta = JSON.parse(res.headers.get("x-raven-export") ?? "{}") as { count?: number; missing?: number };
	const bytes = new Uint8Array(await res.arrayBuffer());
	return { chunk, bytes, count: meta.count ?? chunk.count, missing: meta.missing ?? 0, ms: performance.now() - started };
}

async function report(outcome: "completed" | "partial" | "cancelled" | "failed", errorCode?: string) {
	const { plan, progress, folder, range } = get();
	if (!folder || !range) return;
	await logExportAction({
		folder,
		range,
		outcome,
		total: plan?.total ?? 0,
		saved: progress?.done ?? 0,
		bytes: progress?.receivedBytes ?? 0,
		...(errorCode ? { errorCode } : {}),
	}).catch(() => {});
}

async function pump() {
	const plan = get().plan;
	if (!plan || !sink) return;
	controller = new AbortController();
	const { signal } = controller;
	set({ phase: "running", error: null, pausedByUser: false });

	while (chunkIndex < plan.chunks.length) {
		let attempt = 0;
		for (;;) {
			try {
				const got = await fetchChunk(plan, chunkIndex, signal);
				await sink.write(got.bytes);
				const progress = advance(get().progress!, {
					plannedBytes: got.chunk.bytes,
					plannedCount: got.chunk.count,
					count: got.count,
					receivedBytes: got.bytes.byteLength,
					missing: got.missing,
					ms: got.ms,
				});
				chunkIndex += 1;
				set({ progress });
				break;
			} catch (err) {
				if (signal.aborted) return; // pause/abort already set the phase
				const e = toApiError(err);
				if (!FATAL.has(e.code) && e.retryable !== false && attempt < RETRY_DELAYS.length) {
					await new Promise((r) => setTimeout(r, e.retryAfterMs ?? RETRY_DELAYS[attempt++]));
					if (signal.aborted) return;
					continue;
				}
				set({ phase: "paused", error: failure(e) });
				return;
			}
		}
	}

	set({ phase: "saving" });
	try {
		await sink.close();
	} catch (err) {
		set({ phase: "paused", error: failure(toApiError(err)) });
		return;
	}
	sink = null;
	holdPage(false);
	const p = get().progress!;
	set({
		phase: "done",
		outcome: `${p.done.toLocaleString("en-US")} ${p.done === 1 ? "message" : "messages"} saved${p.missing ? ` · ${p.missing} deleted before they could be read` : ""}`,
	});
	void report("completed");
}

export const exportRun = {
	/**
	 * Call straight from the click handler: the save picker needs the gesture,
	 * so it runs before anything else is awaited.
	 */
	async start(folder: string, range: ExportRange) {
		if (["planning", "running", "saving", "paused"].includes(get().phase)) return;
		const fileName = exportFileName(folder, new Date());
		const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
		let next: Sink;
		if (picker) {
			try {
				next = await diskSink(await picker({ suggestedName: fileName, types: [{ description: "Mailbox (mbox)", accept: { "application/mbox": [".mbox"] } }] }));
			} catch (err) {
				if ((err as { name?: string })?.name === "AbortError") return; // picker dismissed
				next = memorySink(fileName);
			}
		} else {
			next = memorySink(fileName);
		}

		sink = next;
		chunkIndex = 0;
		controller = new AbortController();
		holdPage(true);
		set({ ...INITIAL, phase: "planning", folder, range, fileName, sink: next.kind });

		try {
			const res = await fetch("/api/integrations/export/plan", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ folder, range }),
				signal: controller.signal,
			});
			if (res.status === 401) {
				window.location.replace("/login");
				return;
			}
			if (!res.ok) throw await readApiError(res);
			const plan = ((await res.json()) as { data: ExportPlan }).data;
			if (plan.total === 0) {
				await sink.discard();
				sink = null;
				holdPage(false);
				set({ phase: "stopped", plan, outcome: "Nothing to export in that range." });
				return;
			}
			set({ plan, progress: startProgress({ total: plan.total, bytes: plan.bytes, chunks: plan.chunks.length }) });
		} catch (err) {
			if (controller?.signal.aborted) return;
			await sink?.discard().catch(() => {});
			sink = null;
			holdPage(false);
			const e = failure(toApiError(err));
			set({ phase: "stopped", error: e, outcome: e.message });
			return;
		}
		await pump();
	},

	/** Stop after the chunk in flight is dropped; nothing written is lost. */
	pause() {
		if (get().phase !== "running") return;
		controller?.abort();
		set({ phase: "paused", pausedByUser: true, error: null });
	},

	/** Resume, or retry the chunk that failed. */
	resume() {
		if (get().phase !== "paused" || !sink) return;
		void pump();
	},

	/** Finish early: close the file with the whole messages already saved. */
	async keepPartial() {
		if (get().phase !== "paused" || !sink) return;
		set({ phase: "saving" });
		await sink.close().catch(() => {});
		sink = null;
		holdPage(false);
		const p = get().progress;
		const error = get().error;
		set({
			phase: "stopped",
			outcome: `Saved ${p?.done.toLocaleString("en-US") ?? 0} of ${get().plan?.total.toLocaleString("en-US") ?? 0} messages`,
		});
		void report(error ? "failed" : "partial", error?.code);
	},

	async discard() {
		const phase = get().phase;
		if (phase !== "paused" && phase !== "planning") return;
		controller?.abort();
		await sink?.discard().catch(() => {});
		sink = null;
		holdPage(false);
		set({ phase: "stopped", outcome: "Export discarded — nothing was saved." });
		void report("cancelled", get().error?.code);
	},

	/** Sign-out and hard stops: drop everything, no prompts. */
	abort() {
		controller?.abort();
		void sink?.discard().catch(() => {});
		sink = null;
		if (typeof window !== "undefined") holdPage(false);
		useExportRun.setState(INITIAL);
	},

	/** Clear a finished run so the panel shows the form again. */
	dismiss() {
		if (get().phase === "done" || get().phase === "stopped") useExportRun.setState(INITIAL);
	},
};
