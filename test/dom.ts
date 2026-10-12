/*
 * DOM harness — the FIRST import of every `*.dom.test.tsx`.
 *
 * Registers happy-dom globals for this file only (the suite runs with
 * `--isolate`, and afterAll unregisters anyway), so route tests keep Node's
 * fetch/Request/Response.
 *
 * LOAD ORDER: React DOM (canUseDOM, input-event detection) and Testing
 * Library's `screen` sniff for `document` when they load, and bun evaluates
 * CommonJS packages such as these while linking — before this module's body
 * runs, in no order a test file can control. So test files import only this
 * module (plus bun:test and types) statically, and load Testing Library and
 * the code under test with top-level `await import(...)`:
 *
 *   import { router } from "@/test/dom";
 *   import { expect, test } from "bun:test";
 *   const { render, screen } = await import("@testing-library/react");
 *   const { Thing } = await import("./thing");
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, mock } from "bun:test";

const g = globalThis as Record<string, unknown>;

// happy-dom brings its own fetch stack; keep the runtime's so a stubbed
// `fetch` hands hooks a real Response with a native ReadableStream body.
const NATIVE_KEYS = [
	"fetch",
	"Request",
	"Response",
	"Headers",
	"FormData",
	"ReadableStream",
	"WritableStream",
	"TransformStream",
	"TextEncoder",
	"TextDecoder",
] as const;
const native = Object.fromEntries(NATIVE_KEYS.map((k) => [k, g[k]]));

GlobalRegistrator.register({ url: "http://localhost:3000/", width: 1280, height: 800 });

for (const k of NATIVE_KEYS) {
	if (native[k] !== undefined) Object.defineProperty(globalThis, k, { value: native[k], writable: true, configurable: true });
}

/* ── ResizeObserver: always replaced, so tests control the measured width ── */

const DEFAULT_WIDTH = 1024;
let observedWidth = DEFAULT_WIDTH;
const liveObservers = new Set<StubResizeObserver>();

class StubResizeObserver {
	#cb: ResizeObserverCallback;
	#targets = new Set<Element>();
	constructor(cb: ResizeObserverCallback) {
		this.#cb = cb;
	}
	observe(target: Element) {
		this.#targets.add(target);
		liveObservers.add(this);
		queueMicrotask(() => this.#fire([target]));
	}
	unobserve(target: Element) {
		this.#targets.delete(target);
		if (this.#targets.size === 0) liveObservers.delete(this);
	}
	disconnect() {
		this.#targets.clear();
		liveObservers.delete(this);
	}
	/** @internal */
	notify() {
		this.#fire([...this.#targets]);
	}
	#fire(targets: Element[]) {
		const live = targets.filter((t) => this.#targets.has(t));
		if (!live.length) return;
		const width = observedWidth;
		const entries = live.map((target) => {
			const rect = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: width, width, height: 0, toJSON: () => ({}) };
			const size = [{ inlineSize: width, blockSize: 0 }];
			return { target, contentRect: rect, borderBoxSize: size, contentBoxSize: size, devicePixelContentBoxSize: size };
		});
		this.#cb(entries as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
	}
}

/**
 * Content-box width every stubbed ResizeObserver reports. Call before render
 * (observe() reports on the next microtask) or after, to resize live observers.
 */
export function setObservedWidth(width: number): void {
	observedWidth = width;
	for (const o of liveObservers) o.notify();
}

g.ResizeObserver = StubResizeObserver;

/* ── IntersectionObserver: everything is on screen ── */

class StubIntersectionObserver {
	#cb: IntersectionObserverCallback;
	#targets = new Set<Element>();
	readonly root = null;
	readonly rootMargin = "0px";
	readonly thresholds = [0];
	constructor(cb: IntersectionObserverCallback) {
		this.#cb = cb;
	}
	observe(target: Element) {
		this.#targets.add(target);
		queueMicrotask(() => {
			if (!this.#targets.has(target)) return;
			const rect = target.getBoundingClientRect();
			const entry = {
				target,
				isIntersecting: true,
				intersectionRatio: 1,
				boundingClientRect: rect,
				intersectionRect: rect,
				rootBounds: null,
				time: performance.now(),
			};
			this.#cb([entry as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
		});
	}
	unobserve(target: Element) {
		this.#targets.delete(target);
	}
	disconnect() {
		this.#targets.clear();
	}
	takeRecords() {
		return [];
	}
}
g.IntersectionObserver = StubIntersectionObserver;

/* ── Gaps some happy-dom builds leave ── */

if (typeof window.matchMedia !== "function") {
	window.matchMedia = (query: string) =>
		({
			matches: false,
			media: query,
			onchange: null,
			addEventListener() {},
			removeEventListener() {},
			addListener() {},
			removeListener() {},
			dispatchEvent: () => false,
		}) as unknown as MediaQueryList;
}

const css = (g.CSS ??= {}) as { escape?: (v: string) => string };
if (typeof css.escape !== "function") {
	css.escape = (v: string) => v.replace(/[^a-zA-Z0-9_ -￿-]/g, (c) => `\\${c}`);
}

if (typeof g.requestAnimationFrame !== "function") {
	g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
	g.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

/* ── Next.js client modules ── */

export const router = {
	refresh: mock(() => {}),
	push: mock<(href: string) => void>(() => {}),
	replace: mock<(href: string) => void>(() => {}),
	back: mock(() => {}),
	forward: mock(() => {}),
	prefetch: mock<(href: string) => void>(() => {}),
};

mock.module("next/navigation", () => ({
	useRouter: () => router,
	usePathname: () => "/",
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	redirect: (href: string) => {
		throw new Error(`redirect(${href})`);
	},
	notFound: () => {
		throw new Error("notFound()");
	},
}));

mock.module("next/link", async () => {
	const React = await import("react");
	const Link = React.forwardRef<HTMLAnchorElement, Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string | { pathname?: string }; prefetch?: unknown; replace?: unknown; scroll?: unknown }>(
		function Link({ href, ...props }, ref) {
			const rest: Record<string, unknown> = { ...props };
			for (const k of ["prefetch", "replace", "scroll"]) delete rest[k];
			return React.createElement("a", { ...rest, ref, href: typeof href === "string" ? href : (href.pathname ?? "") });
		},
	);
	return { default: Link, __esModule: true };
});

/* ── Response builders for stubbed fetch ── */

/**
 * A streamed NDJSON Response. Each event becomes its own chunk; pass
 * `{ split: true }` to cut every line in two across chunks.
 */
export function ndjsonResponse(events: readonly unknown[], { status = 200, split = false }: { status?: number; split?: boolean } = {}): Response {
	const enc = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const e of events) {
				const line = `${JSON.stringify(e)}\n`;
				if (split) {
					const mid = Math.floor(line.length / 2);
					controller.enqueue(enc.encode(line.slice(0, mid)));
					controller.enqueue(enc.encode(line.slice(mid)));
				} else {
					controller.enqueue(enc.encode(line));
				}
			}
			controller.close();
		},
	});
	return new Response(body, { status, headers: { "content-type": "application/x-ndjson" } });
}

export function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/* ── Lifecycle ── */

const { cleanup } = await import("@testing-library/react");

afterEach(() => {
	cleanup();
	observedWidth = DEFAULT_WIDTH;
	for (const fn of Object.values(router)) fn.mockClear();
});

afterAll(async () => {
	// React may still have passive-effect work queued on the scheduler (e.g. a
	// Base UI dialog torn down by cleanup). Let it drain while `window` exists.
	for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 10));
	await GlobalRegistrator.unregister();
});
