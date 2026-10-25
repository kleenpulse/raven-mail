"use client";

import * as React from "react";
import { Download, ExternalLink, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { GrowDialog } from "@/components/motion-garden/grow-dialog";
import { attachmentHref, base64ToBytes, previewType } from "@/lib/mail/attachment";
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

async function loadBlob(source: PreviewSource, type: string, signal: AbortSignal): Promise<Blob> {
	if ("contentBase64" in source) return new Blob([base64ToBytes(source.contentBase64)], { type });
	const res = await fetch(attachmentHref(source.folder, source.uid, source.part), { cache: "no-store", signal });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	// The response says octet-stream for active types; the metadata's type decides how it shows.
	return new Blob([await res.arrayBuffer()], { type });
}

/**
 * Opens previewable attachments in a Grow Dialog that grows out of the clicked chip.
 * Callers check `canPreview` first; anything else downloads as before.
 */
export function useAttachmentPreview() {
	const [shown, setShown] = React.useState<Shown | null>(null);
	// The one live blob URL. Swapped (old one revoked) whenever a new file replaces it.
	const urlRef = React.useRef<string | null>(null);
	const abortRef = React.useRef<AbortController | null>(null);
	const idRef = React.useRef(0);
	// Read by the exit callback: AnimatePresence keeps the exiting panel's old props, whose `shown` still says open.
	const openRef = React.useRef(false);

	const swapUrl = React.useCallback((next: string | null) => {
		if (urlRef.current && urlRef.current !== next) URL.revokeObjectURL(urlRef.current);
		urlRef.current = next;
	}, []);

	// Compose sent or discarded, or the reader closed, with a preview still up.
	React.useEffect(() => {
		const urls = urlRef;
		const aborts = abortRef;
		return () => {
			aborts.current?.abort();
			if (urls.current) URL.revokeObjectURL(urls.current);
			urls.current = null;
		};
	}, []);

	const open = React.useCallback(
		(source: PreviewSource, trigger: HTMLElement) => {
			const type = previewType(source.contentType, source.filename);
			if (!type) return;
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
		[swapUrl],
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

	const dialog = (
		<AttachmentPreviewDialog shown={shown} onOpenChange={(next) => !next && close()} onAnimationComplete={onAnimationComplete} />
	);

	return { open, dialog };
}

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
					<Tip
						label={`Download ${shown.filename}`}
						render={
							<a
								href={shown.url}
								download={shown.filename}
								aria-label={`Download ${shown.filename}`}
								className="rounded-md p-1.5 text-ink-2 transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none"
							/>
						}
					>
						<Download aria-hidden className="size-4" />
					</Tip>
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
