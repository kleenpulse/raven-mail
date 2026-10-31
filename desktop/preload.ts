import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { CHANNELS, type NewMail } from "./bridge";

/*
 * Runs sandboxed in the main window's top frame before the page. It has no
 * Node.js; it only passes two kinds of message, and main checks both
 * (bridge.ts). Child windows and email frames don't get it.
 */

contextBridge.exposeInMainWorld("ravenDesktop", {
	notifyNewMail(items: NewMail[]): void {
		ipcRenderer.send(CHANNELS.notifyNewMail, items);
	},
	onOpen(callback: (path: string) => void): () => void {
		const listener = (_event: IpcRendererEvent, path: unknown) => {
			if (typeof path === "string") callback(path);
		};
		ipcRenderer.on(CHANNELS.open, listener);
		return () => void ipcRenderer.removeListener(CHANNELS.open, listener);
	},
});
