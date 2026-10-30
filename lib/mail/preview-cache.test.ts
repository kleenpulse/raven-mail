import { afterEach, describe, expect, test } from "bun:test";
import { forgetPreviews, loadPreview, recallPreview, rememberPreview } from "./preview-cache";

const bytes = (n: number) => new Blob([new Uint8Array(n)]);

afterEach(forgetPreviews);

describe("preview cache", () => {
	test("gives back what it was given", () => {
		const blob = bytes(4);
		rememberPreview("INBOX/7/2", blob);
		expect(recallPreview("INBOX/7/2")).toBe(blob);
		expect(recallPreview("INBOX/7/3")).toBeUndefined();
	});

	test("past the budget, the least recently opened file goes first", () => {
		rememberPreview("a", bytes(4), 10);
		rememberPreview("b", bytes(4), 10);
		recallPreview("a");
		rememberPreview("c", bytes(4), 10);
		expect(recallPreview("b")).toBeUndefined();
		expect(recallPreview("a")).toBeDefined();
		expect(recallPreview("c")).toBeDefined();
	});

	test("a file bigger than the whole budget isn't kept, and pushes nothing out", () => {
		rememberPreview("a", bytes(4), 10);
		rememberPreview("huge", bytes(11), 10);
		expect(recallPreview("huge")).toBeUndefined();
		expect(recallPreview("a")).toBeDefined();
	});

	test("saving the same key again replaces it without counting it twice", () => {
		rememberPreview("a", bytes(6), 10);
		rememberPreview("a", bytes(6), 10);
		rememberPreview("b", bytes(4), 10);
		expect(recallPreview("a")).toBeDefined();
		expect(recallPreview("b")).toBeDefined();
	});

	test("forgetting empties it", () => {
		rememberPreview("a", bytes(4));
		forgetPreviews();
		expect(recallPreview("a")).toBeUndefined();
	});
});

/** A download the test finishes by hand, recording the signal it was given. */
function manual() {
	let finish!: (blob: Blob) => void;
	const calls: AbortSignal[] = [];
	const load = (signal: AbortSignal) => {
		calls.push(signal);
		return new Promise<Blob>((resolve, reject) => {
			finish = resolve;
			signal.addEventListener("abort", () => reject(signal.reason));
		});
	};
	return { load, calls, finish: (blob: Blob) => finish(blob) };
}

describe("loadPreview", () => {
	test("callers asking for the same file while it downloads share one download", async () => {
		const dl = manual();
		const a = loadPreview("k", dl.load);
		const b = loadPreview("k", dl.load, new AbortController().signal);
		const blob = bytes(3);
		dl.finish(blob);
		expect(await a).toBe(blob);
		expect(await b).toBe(blob);
		expect(dl.calls).toHaveLength(1);
		// Kept, so the next ask doesn't download at all.
		expect(await loadPreview("k", dl.load)).toBe(blob);
		expect(dl.calls).toHaveLength(1);
	});

	test("the download is cancelled only when the last caller stops waiting", async () => {
		const dl = manual();
		const one = new AbortController();
		const two = new AbortController();
		const first = loadPreview("k", dl.load, one.signal);
		const second = loadPreview("k", dl.load, two.signal);
		one.abort();
		await expect(first).rejects.toBeDefined();
		expect(dl.calls[0]!.aborted).toBe(false);
		two.abort();
		await expect(second).rejects.toBeDefined();
		expect(dl.calls[0]!.aborted).toBe(true);
		// The next ask starts afresh rather than joining the cancelled one.
		void loadPreview("k", dl.load).catch(() => {});
		expect(dl.calls).toHaveLength(2);
	});

	test("a caller with no signal keeps the download alive for itself", async () => {
		const dl = manual();
		const viewer = new AbortController();
		const prefetch = loadPreview("k", dl.load);
		const shown = loadPreview("k", dl.load, viewer.signal);
		viewer.abort();
		await expect(shown).rejects.toBeDefined();
		expect(dl.calls[0]!.aborted).toBe(false);
		dl.finish(bytes(2));
		expect((await prefetch).size).toBe(2);
	});

	test("a failed download isn't kept, and the next ask tries again", async () => {
		let n = 0;
		const load = async () => {
			n += 1;
			if (n === 1) throw new Error("HTTP 500");
			return bytes(1);
		};
		await expect(loadPreview("k", load)).rejects.toThrow("HTTP 500");
		expect((await loadPreview("k", load)).size).toBe(1);
	});

	test("forgetting cancels a download in flight, and its bytes are never kept", async () => {
		const dl = manual();
		const waiting = loadPreview("k", dl.load);
		forgetPreviews();
		expect(dl.calls[0]!.aborted).toBe(true);
		await expect(waiting).rejects.toBeDefined();
		expect(recallPreview("k")).toBeUndefined();
	});
});
