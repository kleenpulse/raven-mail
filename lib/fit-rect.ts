/** Box geometry for grow-from-trigger (FLIP) overlays. Pure, so tests can pin it. */

export type Rect = { top: number; left: number; width: number; height: number };

/** A plain copy of a DOMRect: later layout changes can't mutate it. */
export function toRect(rect: DOMRect | Rect): Rect {
	return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/** The largest box of `aspectRatio` that fits the padded viewport, centered, never smaller than the min size. */
export function getCenteredRect({
	viewportWidth,
	viewportHeight,
	aspectRatio,
	padding,
	minWidth = 0,
	minHeight = 0,
}: {
	viewportWidth: number;
	viewportHeight: number;
	aspectRatio: number;
	padding: number;
	minWidth?: number;
	minHeight?: number;
}): Rect {
	const ratio = aspectRatio > 0 && Number.isFinite(aspectRatio) ? aspectRatio : 1;
	const maxWidth = Math.max(0, viewportWidth - padding * 2);
	const maxHeight = Math.max(0, viewportHeight - padding * 2);

	let width = maxWidth;
	let height = width / ratio;
	if (height > maxHeight) {
		height = maxHeight;
		width = height * ratio;
	}
	width = Math.max(minWidth, width);
	height = Math.max(minHeight, height);

	return { top: (viewportHeight - height) / 2, left: (viewportWidth - width) / 2, width, height };
}
