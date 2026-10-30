import { safeStorage } from "electron";
import type { Sealer } from "./secrets";

/**
 * Electron safeStorage (async API; the sync one is deprecated in Electron 45).
 * On Linux without a keyring the backend is basic_text, which doesn't really
 * encrypt: then the secrets file is stored as is (owner-only) and the caller
 * logs a warning. Chromium gives its cookie store the same protection there.
 */
export async function electronSealer(): Promise<Sealer> {
	const linux = process.platform === "linux";
	const backend = linux ? safeStorage.getSelectedStorageBackend() : process.platform;
	const available = await safeStorage.isAsyncEncryptionAvailable();
	const protects = available && !(linux && (backend === "basic_text" || backend === "unknown"));
	return {
		backend,
		protects,
		seal: (text) => safeStorage.encryptStringAsync(text),
		open: async (sealed) => {
			const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(sealed);
			return { text: result, reseal: shouldReEncrypt };
		},
	};
}
