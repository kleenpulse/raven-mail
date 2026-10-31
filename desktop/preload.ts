import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { CHANNELS, type MailAppStatus, type NewMail } from "./bridge";

/*
 * Runs sandboxed in the main window's top frame before the page. It has no
 * Node.js; it only passes a few kinds of message, and main checks each one
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
	mailApp: {
		status: (): Promise<MailAppStatus> => ipcRenderer.invoke(CHANNELS.mailAppStatus),
		claim: (): Promise<MailAppStatus> => ipcRenderer.invoke(CHANNELS.mailAppClaim),
	},
});
