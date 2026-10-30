/*
 * bun run desktop:dev   Electron on `next dev` (HMR, "Continue in dev mode")
 *
 * RAVEN_DEBUG_PORT=9222 opens Chrome DevTools Protocol on that port (unpackaged only).
 */
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { bundleMain } from "./bundle";

const root = resolve(import.meta.dir, "../..");
const entry = join(root, "desktop", ".dev");
await bundleMain(root, entry);

const env: Record<string, string | undefined> = { ...process.env, RAVEN_DESKTOP_MODE: "dev", RAVEN_REPO_ROOT: root };
// Terminals inside VS Code (an Electron app) inherit this; it would start Electron as plain Node.
delete env.ELECTRON_RUN_AS_NODE;

const electronCli = join(root, "desktop", "node_modules", "electron", "cli.js");
const child = spawn(process.env.RAVEN_NODE || "node", [electronCli, entry], { cwd: root, stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
