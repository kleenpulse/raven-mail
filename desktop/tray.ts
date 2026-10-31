import { app, Menu, nativeImage, Tray } from "electron";
import { join } from "node:path";

/*
 * The tray icon on Windows and Linux. Clicking it shows the window; its menu
 * opens Raven, turns "keep running" on or off, and quits. Linux desktops
 * without AppIndicator show no icon; opening Raven again shows the window.
 */

export type TrayActions = {
	open(): void;
	keepRunning(): boolean;
	setKeepRunning(on: boolean): void;
	quit(): void;
};

export type RavenTray = { refresh(): void; destroy(): void };

export function createTray(actions: TrayActions): RavenTray {
	// tray@2x.png sits next to it and is picked up on high-DPI screens.
	const icon = nativeImage.createFromPath(join(app.getAppPath(), "tray.png"));
	const tray = new Tray(icon);
	tray.setToolTip("Raven");
	const refresh = () => {
		tray.setContextMenu(
			Menu.buildFromTemplate([
				{ label: "Open Raven", click: actions.open },
				{ type: "separator" },
				{ label: KEEP_RUNNING_LABEL, type: "checkbox", checked: actions.keepRunning(), click: (item) => actions.setKeepRunning(item.checked) },
				{ type: "separator" },
				{ label: "Quit Raven", click: actions.quit },
			]),
		);
	};
	tray.on("click", actions.open);
	refresh();
	return { refresh, destroy: () => tray.destroy() };
}

export const KEEP_RUNNING_LABEL = "Keep running when the window is closed";
