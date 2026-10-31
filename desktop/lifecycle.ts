/*
 * What closing the window does. With "keep running" on, closing hides the
 * window and the page keeps checking for mail; quitting (from the tray, the
 * menu, or the OS logging off) always closes for real.
 */

export type Lifecycle = {
	keepRunning: boolean;
	/** Quit has started (before-quit), or the OS is ending the session. */
	quitting: boolean;
	platform: NodeJS.Platform;
};

export type CloseAction = "hide" | "close";

export function onWindowClose(state: Lifecycle): CloseAction {
	if (state.quitting) return "close";
	return state.keepRunning ? "hide" : "close";
}

/** After the last window closed: macOS apps stay open in the Dock. */
export function onAllWindowsClosed(state: Lifecycle): "quit" | "stay" {
	if (state.platform === "darwin") return "stay";
	return state.keepRunning && !state.quitting ? "stay" : "quit";
}

/** Windows and Linux show a tray icon; macOS has the Dock. */
export function hasTray(platform: NodeJS.Platform): boolean {
	return platform !== "darwin";
}

/** The one-time "still running" notice, the first time a close hides the window to the tray. */
export function showTrayHint(state: Lifecycle, action: CloseAction, hintShown: boolean): boolean {
	return action === "hide" && !hintShown && hasTray(state.platform);
}
