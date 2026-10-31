import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/*
 * The main window's size and place, kept in window-state.json between
 * launches. A saved place is only reused while it's still on a screen
 * (monitors get unplugged), and the size always fits the screen it opens on.
 */

export type Rect = { x: number; y: number; width: number; height: number };
export type WindowState = { bounds: Rect; maximized: boolean };
export type Placement = { width: number; height: number; x?: number; y?: number; maximized: boolean };

export const MIN_SIZE = { width: 900, height: 600 } as const;
export const DEFAULT_SIZE = { width: 1280, height: 840 } as const;

/** How much of the window's top edge must be on a screen to count as reachable. */
const GRIP = { width: 120, height: 40 };

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

export function parseWindowState(text: string | null): WindowState | null {
	if (!text) return null;
	try {
		const raw = JSON.parse(text) as { bounds?: Partial<Rect>; maximized?: unknown } | null;
		const b = raw?.bounds;
		if (!b || !isInt(b.x) || !isInt(b.y) || !isInt(b.width) || !isInt(b.height)) return null;
		if (b.width <= 0 || b.height <= 0) return null;
		return { bounds: { x: b.x, y: b.y, width: b.width, height: b.height }, maximized: raw?.maximized === true };
	} catch {
		return null;
	}
}

export function windowStateRecord(state: WindowState): string {
	return `${JSON.stringify(state, null, 2)}\n`;
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
	return {
		width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
		height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
	};
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));

/**
 * Where the window opens. `screens` are the displays' work areas, primary
 * first. With no usable saved place, the default size is centred by Electron.
 */
export function placeWindow(saved: WindowState | null, screens: readonly Rect[]): Placement {
	const primary = screens[0];
	const fit = (width: number, height: number, area: Rect | undefined) => ({
		width: area ? clamp(width, Math.min(MIN_SIZE.width, area.width), area.width) : Math.max(width, MIN_SIZE.width),
		height: area ? clamp(height, Math.min(MIN_SIZE.height, area.height), area.height) : Math.max(height, MIN_SIZE.height),
	});
	if (!saved) return { ...fit(DEFAULT_SIZE.width, DEFAULT_SIZE.height, primary), maximized: false };

	const { bounds } = saved;
	const titleBar: Rect = { x: bounds.x, y: bounds.y, width: bounds.width, height: GRIP.height };
	const home = screens.find((area) => {
		const seen = overlap(titleBar, area);
		return seen.width >= Math.min(GRIP.width, bounds.width) && seen.height >= Math.min(GRIP.height, bounds.height);
	});
	if (!home) return { ...fit(bounds.width, bounds.height, primary), maximized: saved.maximized };

	const size = fit(bounds.width, bounds.height, home);
	// Pull the window fully onto its screen when the size fits but the place spills over.
	const x = clamp(bounds.x, home.x, home.x + home.width - size.width);
	const y = clamp(bounds.y, home.y, home.y + home.height - size.height);
	return { ...size, x, y, maximized: saved.maximized };
}

function stateFile(userData: string): string {
	return join(userData, "window-state.json");
}

export function loadWindowState(userData: string): WindowState | null {
	try {
		return parseWindowState(readFileSync(stateFile(userData), "utf8"));
	} catch {
		return null;
	}
}

export function saveWindowState(userData: string, state: WindowState): void {
	const path = stateFile(userData);
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, windowStateRecord(state));
	renameSync(tmp, path);
}
