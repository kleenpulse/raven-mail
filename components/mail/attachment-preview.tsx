"use client";

import * as React from "react";
import { Download, ExternalLink, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { GrowDialog } from "@/components/motion-garden/grow-dialog";
import { MediaViewer, type MediaItem } from "@/components/mail/media-viewer";
import { attachmentHref, base64ToBytes, isMediaType, previewType } from "@/lib/mail/attachment";
import { loadPreview } from "@/lib/mail/preview-cache";
import { formatBytes } from "@/lib/format";

/** Text past this isn't decoded: a 50 MB log would otherwise be read in full, then cut. */
export const TEXT_PREVIEW_BYTES = 1_000_000;

/** Bytes already in the page (a compose attachment) or a part of a message on the server. */
export type PreviewSource =
	| { filename: string; contentType: string; size: number; contentBase64: string }
	| { filename: string; contentType: string; size: number; folder: string; uid: string; part: string };

type Shown = {
	id: number;
	open: boolean;
	origin: DOMRect | null;
	filename: string;
	size: number;
	/** From the message metadata, via previewType. Never from the download response. */
	type: string;
	/** Null while the bytes load. */
	url: string | null;
	text?: string;
	truncated?: boolean;
};

const COARSE = "(pointer: coarse)";
function subscribeCoarse(onChange: () => void) {
	const mql = window.matchMedia(COARSE);
	mql.addEventListener("change", onChange);
	return () => mql.removeEventListener("change", onChange);
}

/** Phones and tablets: their browsers show a PDF in a frame as blank or a download link. */
function useCoarsePointer(): boolean {
	return React.useSyncExternalStore(subscribeCoarse, () => window.matchMedia(COARSE).matches, () => false);
}

/**
 * A stable id for a file, so a chip and the viewer agree on it without sharing objects:
 * the reader rebuilds its sources every render. Local bytes use their place in the
 * caller's full list.
 */
export function previewKey(source: PreviewSource, index: number): string {
	return "contentBase64" in source ? `compose/${index}` : `${source.folder}/${source.uid}/${source.part}`;
}

/** The chip a viewer item came from, by its `data-preview-key`. */
function chipFor(key: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(`[data-preview-key="${CSS.escape(key)}"]`);
}

/** The other media around the clicked file: the message's or the draft's attachments. */
export type PreviewGallery = { sources: PreviewSource[]; index: number };

type MediaShown = { id: number; items: MediaItem[]; index: number; origin: DOMRect };

// The whole file is fetched before it shows, video included: fine under PREVIEW_MAX_BYTES.
// Streaming video would need a Range-capable route and the server's own type on the response.
async function loadBlob(source: PreviewSource, type: string, signal?: AbortSignal): Promise<Blob> {
	if ("contentBase64" in source) return new Blob([base64ToBytes(source.contentBase64)], { type });
	const href = attachmentHref(source.folder, source.uid, source.part);
	const blob = await loadPreview(
		previewKey(source, 0),
		async (s) => {
			const res = await fetch(href, { cache: "no-store", signal: s });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			// The response says octet-stream for active types; the metadata's type decides how it shows.
			return new Blob([await res.arrayBuffer()], { type });
		},
		signal,
	);
	return blob.type === type ? blob : blob.slice(0, blob.size, type);
}

/** Media up to this size starts downloading before the click; bigger files wait for it. */
export const PREFETCH_MAX_BYTES = 8 * 1024 * 1024;
/** How long the pointer or focus rests on a chip first, so sweeping across a row fetches nothing. */
export const PREFETCH_REST_MS = 120;

function prefetchPreview(source: PreviewSource): void {
	if ("contentBase64" in source || source.size > PREFETCH_MAX_BYTES) return;
	const type = previewType(source.contentType, source.filename);
	if (!type || !isMediaType(type)) return;
	// No signal: once started it finishes, and the click that follows joins it.
	loadBlob(source, type).catch(() => {
		/* the click will try again and show the failure */
	});
}

const restTimers = new WeakMap<EventTarget, number>();

/**
 * Chip handlers that start a small image or video downloading while the user is about
 * to click it: after a short hover or keyboard focus, and at once on press, which comes
 * ~100 ms before the click (the only head start a touch screen gives).
 */
export function prefetchProps(source: PreviewSource) {
	const arm = (target: EventTarget) => {
		window.clearTimeout(restTimers.get(target));
		restTimers.set(target, window.setTimeout(() => prefetchPreview(source), PREFETCH_REST_MS));
	};
	const disarm = (target: EventTarget) => {
		window.clearTimeout(restTimers.get(target));
		restTimers.delete(target);
	};
	return {
		onPointerEnter: (e: React.PointerEvent) => {
			if (e.pointerType !== "touch") arm(e.currentTarget);
		},
		onPointerLeave: (e: React.PointerEvent) => disarm(e.currentTarget),
		onFocus: (e: React.FocusEvent) => arm(e.currentTarget),
		onBlur: (e: React.FocusEvent) => disarm(e.currentTarget),
		onPointerDown: (e: React.PointerEvent) => {
			disarm(e.currentTarget);
			prefetchPreview(source);
		},
	};
}

/**
 * Opens previewable attachments where they were clicked. Images and videos open in the
 * media viewer, with the other media in `gallery` a step away. Documents, text and audio
 * open in a Grow Dialog. Callers check `canPreview` first; anything else downloads as before.
 */
export function useAttachmentPreview() {
	const [shown, setShown] = React.useState<Shown | null>(null);
	// The one live blob URL. Swapped (old one revoked) whenever a new file replaces it.
	const urlRef = React.useRef<string | null>(null);
	const abortRef = React.useRef<AbortController | null>(null);
	const idRef = React.useRef(0);
	// Read by the exit callback: AnimatePresence keeps the exiting panel's old props, whose `shown` still says open.
	const openRef = React.useRef(false);

	const [media, setMedia] = React.useState<MediaShown | null>(null);
	// Lined up with media.items. Blob URLs and fetches exist only for the shown item and its two neighbours.
	const mediaSourcesRef = React.useRef<{ source: PreviewSource; type: string; key: string }[]>([]);
	const mediaUrlsRef = React.useRef(new Map<string, string>());
	const mediaAbortsRef = React.useRef(new Map<string, AbortController>());
	const mediaFailedRef = React.useRef(new Set<string>());

	const swapUrl = React.useCallback((next: string | null) => {
		if (urlRef.current && urlRef.current !== next) URL.revokeObjectURL(urlRef.current);
		urlRef.current = next;
	}, []);

	/** Abort and revoke every media file not in `keep`. */
	const releaseMedia = React.useCallback((keep?: ReadonlySet<string>) => {
		for (const [key, controller] of mediaAbortsRef.current) {
			if (keep?.has(key)) continue;
			controller.abort();
			mediaAbortsRef.current.delete(key);
		}
		for (const [key, url] of mediaUrlsRef.current) {
			if (keep?.has(key)) continue;
			URL.revokeObjectURL(url);
			mediaUrlsRef.current.delete(key);
		}
	}, []);

	// Compose sent or discarded, or the reader closed, with a preview still up.
	React.useEffect(() => {
		const urls = urlRef;
		const aborts = abortRef;
		return () => {
			aborts.current?.abort();
			if (urls.current) URL.revokeObjectURL(urls.current);
			urls.current = null;
			releaseMedia();
		};
	}, [releaseMedia]);

	const patchItem = React.useCallback((id: number, key: string, patch: Partial<MediaItem>) => {
		setMedia((m) =>
			m?.id === id ? { ...m, items: m.items.map((item) => (item.key === key ? { ...item, ...patch } : item)) } : m,
		);
	}, []);

	/** Load the item at `index` and its neighbours; drop anything further away. */
	const loadAround = React.useCallback(
		(id: number, index: number) => {
			const list = mediaSourcesRef.current;
			const n = list.length;
			const near = [index, (index + 1) % n, (index - 1 + n) % n].map((i) => list[i]!);
			const keep = new Set(near.map((entry) => entry.key));
			const dropped = [...mediaUrlsRef.current.keys()].filter((key) => !keep.has(key));
			releaseMedia(keep);
			for (const key of dropped) patchItem(id, key, { url: null });

			// The shown item first, so it isn't queued behind its neighbours.
			for (const entry of near) {
				const { key } = entry;
				if (mediaUrlsRef.current.has(key) || mediaAbortsRef.current.has(key) || mediaFailedRef.current.has(key)) continue;
				const controller = new AbortController();
				mediaAbortsRef.current.set(key, controller);
				loadBlob(entry.source, entry.type, controller.signal).then(
					(blob) => {
						if (controller.signal.aborted) return;
						mediaAbortsRef.current.delete(key);
						const url = URL.createObjectURL(blob);
						mediaUrlsRef.current.set(key, url);
						patchItem(id, key, { url });
					},
					() => {
						if (controller.signal.aborted) return;
						// Shown inside the viewer; the other files stay a step away.
						mediaAbortsRef.current.delete(key);
						mediaFailedRef.current.add(key);
						patchItem(id, key, { failed: true });
					},
				);
			}
		},
		[patchItem, releaseMedia],
	);

	const openMedia = React.useCallback(
		(source: PreviewSource, type: string, trigger: HTMLElement, gallery?: PreviewGallery) => {
			const startKey = previewKey(source, gallery?.index ?? 0);
			let entries = (gallery?.sources ?? [source]).flatMap((s, i) => {
				const t = previewType(s.contentType, s.filename);
				return t && isMediaType(t) ? [{ source: s, type: t, key: previewKey(s, i) }] : [];
			});
			let index = entries.findIndex((entry) => entry.key === startKey);
			if (index < 0) {
				entries = [{ source, type, key: startKey }];
				index = 0;
			}
			const id = ++idRef.current;
			releaseMedia();
			mediaFailedRef.current.clear();
			mediaSourcesRef.current = entries;
			setMedia({
				id,
				index,
				origin: trigger.getBoundingClientRect(),
				items: entries.map(({ source: s, type: t, key }) => ({
					key,
					filename: s.filename,
					size: s.size,
					kind: t.startsWith("image/") ? "image" : "video",
					url: null,
					fallbackHref: "contentBase64" in s ? undefined : attachmentHref(s.folder, s.uid, s.part),
				})),
			});
			loadAround(id, index);
		},
		[loadAround, releaseMedia],
	);

	const open = React.useCallback(
		(source: PreviewSource, trigger: HTMLElement, gallery?: PreviewGallery) => {
			const type = previewType(source.contentType, source.filename);
			if (!type) return;
			if (isMediaType(type)) {
				openMedia(source, type, trigger, gallery);
				return;
			}
			const id = ++idRef.current;
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;
			swapUrl(null);
			openRef.current = true;
			setShown({
				id,
				open: true,
				origin: trigger.getBoundingClientRect(),
				filename: source.filename,
				size: source.size,
				type,
				url: null,
			});
			void (async () => {
				try {
					const blob = await loadBlob(source, type, controller.signal);
					const isText = type.startsWith("text/");
					// Slice before decoding, so only the shown part is ever read as text.
					const text = isText ? await blob.slice(0, TEXT_PREVIEW_BYTES).text() : undefined;
					if (controller.signal.aborted) return;
					const url = URL.createObjectURL(blob);
					swapUrl(url);
					setShown((s) => (s?.id === id ? { ...s, url, text, truncated: isText && blob.size > TEXT_PREVIEW_BYTES } : s));
				} catch {
					if (controller.signal.aborted) return;
					toast.error(`Couldn't open ${source.filename}`);
					openRef.current = false;
					setShown((s) => (s?.id === id ? { ...s, open: false } : s));
				}
			})();
		},
		[openMedia, swapUrl],
	);

	const close = React.useCallback(() => {
		abortRef.current?.abort();
		openRef.current = false;
		setShown((s) => (s ? { ...s, open: false } : s));
	}, []);

	const onAnimationComplete = () => {
		if (openRef.current) return;
		swapUrl(null);
		setShown(null);
	};

	const closeMedia = React.useCallback(() => {
		releaseMedia();
		mediaFailedRef.current.clear();
		setMedia(null);
	}, [releaseMedia]);

	const dialog = (
		<>
			<AttachmentPreviewDialog shown={shown} onOpenChange={(next) => !next && close()} onAnimationComplete={onAnimationComplete} />
			{media && (
				<MediaViewer
					key={media.id}
					items={media.items}
					index={media.index}
					originRect={media.origin}
					onIndexChange={(index) => {
						setMedia((m) => (m?.id === media.id ? { ...m, index } : m));
						loadAround(media.id, index);
					}}
					getOrigin={chipFor}
					onClosed={closeMedia}
				/>
			)}
		</>
	);

	return { open, dialog };
}

const HEADER_ACTION =
	"rounded-md p-1.5 text-ink-2 transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none";

function AttachmentPreviewDialog({
	shown,
	onOpenChange,
	onAnimationComplete,
}: {
	shown: Shown | null;
	onOpenChange: (open: boolean) => void;
	onAnimationComplete: () => void;
}) {
	return (
		<GrowDialog
			open={Boolean(shown?.open)}
			onOpenChange={onOpenChange}
			onAnimationComplete={onAnimationComplete}
			originRect={shown?.origin}
			originMaxWidth={896}
			title={<span className="block truncate">{shown?.filename}</span>}
			label={shown ? `Preview of ${shown.filename}` : "Preview"}
			description={shown ? formatBytes(shown.size) : undefined}
			actions={
				shown?.url ? (
					<>
						{/* The blob carries the previewType, so a new tab shows the same safe view: markup stays plain text. */}
						<Tip
							label="Open in new tab"
							render={<a href={shown.url} target="_blank" rel="noopener" aria-label="Open in new tab" className={HEADER_ACTION} />}
						>
							<ExternalLink aria-hidden className="size-4" />
						</Tip>
						<Tip
							label={`Download ${shown.filename}`}
							render={
								<a
									href={shown.url}
									download={shown.filename}
									aria-label={`Download ${shown.filename}`}
									className={HEADER_ACTION}
								/>
							}
						>
							<Download aria-hidden className="size-4" />
						</Tip>
					</>
				) : null
			}
			className="max-w-4xl"
		>
			<div className="min-h-0 flex-1 overflow-auto px-5 pb-5">{shown && <PreviewBody shown={shown} />}</div>
		</GrowDialog>
	);
}

function PreviewBody({ shown }: { shown: Shown }) {
	const coarse = useCoarsePointer();
	const { url, type, filename } = shown;

	if (!url) {
		return (
			<p role="status" className="grid h-48 place-items-center text-[12.5px] text-ink-2">
				<span className="flex items-center gap-2">
					<LoaderCircle aria-hidden className="size-4 animate-spin" />
					Loading {filename}…
				</span>
			</p>
		);
	}

	if (type.startsWith("image/")) {
		return (
			// eslint-disable-next-line @next/next/no-img-element -- a local blob URL, nothing for next/image to optimize
			<img src={url} alt={filename} className="mx-auto max-h-[70svh] w-auto max-w-full rounded-lg bg-card-nested object-contain" />
		);
	}

	if (type.startsWith("video/")) {
		return <video src={url} controls className="max-h-[70svh] w-full rounded-lg bg-black" />;
	}

	if (type.startsWith("audio/")) {
		return <audio src={url} controls className="w-full" />;
	}

	if (type === "application/pdf") {
		if (coarse) {
			return (
				<div className="flex flex-col items-center gap-3 rounded-lg bg-card-nested px-5 py-8 text-center">
					<p className="text-[13px] text-ink-2">This device can&apos;t show PDFs inside the page.</p>
					<Button size="sm" variant="outline" onClick={() => window.open(url, "_blank", "noopener")}>
						<ExternalLink aria-hidden />
						Open in new tab
					</Button>
				</div>
			);
		}
		return <iframe src={url} title={filename} className="h-[75svh] w-full rounded-lg bg-white" />;
	}

	return (
		<>
			{shown.truncated && (
				<p className="mb-2 text-[12px] text-ink-2">Showing the first 1 MB. Download the file to see all of it.</p>
			)}
			<pre className="max-h-[70svh] overflow-auto rounded-lg bg-card-nested p-4 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap">
				{shown.text}
			</pre>
		</>
	);
}
