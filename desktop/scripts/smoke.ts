/*
 * bun desktop/scripts/smoke.ts [server-dir]
 *
 * Boots the staged server under plain Node with a temporary local database
 * (so migrations run) and checks the guard from outside: the app's request
 * gets 200, one without the token gets 403, one with a foreign Host gets 403.
 * This catches a Next upgrade that changes the internals the bootstrap uses.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { request } from "node:http";
import { baseEnv } from "../env";
import { HOST, TOKEN_HEADER } from "../shared";

const serverDir = resolve(process.argv[2] ?? join(import.meta.dir, "..", ".stage", "server"));
const tmp = mkdtempSync(join(tmpdir(), "raven-smoke-"));
const token = randomBytes(32).toString("base64url");

const child = spawn(process.env.RAVEN_NODE || "node", ["raven-server.js"], {
	cwd: serverDir,
	env: {
		...baseEnv(process.env),
		RAVEN_DESKTOP_TOKEN: token,
		PORT: "0",
		RAVEN_DB: "pglite",
		RAVEN_PGLITE_DIR: join(tmp, "db"),
		SESSION_SECRET: randomBytes(32).toString("base64url"),
		ALLOW_LOOPBACK_MAIL_HOSTS: "true",
		NEXT_TELEMETRY_DISABLED: "1",
	},
	stdio: ["ignore", "pipe", "inherit"],
});

/** Raw status code: fetch() can't send a foreign Host header. */
function status(port: number, headers: Record<string, string>): Promise<number> {
	return new Promise((done, fail) => {
		const req = request({ host: HOST, port, path: "/login", headers }, (res) => {
			res.resume();
			done(res.statusCode ?? 0);
		});
		req.on("error", fail);
		req.end();
	});
}

let failed = false;
try {
	const port = await new Promise<number>((done, fail) => {
		const timer = setTimeout(() => fail(new Error("the server didn't report ready within 120 s")), 120_000);
		let buffer = "";
		child.stdout.on("data", (chunk: Buffer) => {
			buffer += chunk.toString();
			for (const line of buffer.split("\n")) {
				const report = /^\{"raven":(.*)\}\s*$/.exec(line.trim());
				if (!report) continue;
				const message = JSON.parse(report[1]!) as { type: string; port?: number; message?: string };
				clearTimeout(timer);
				if (message.type === "ready" && message.port) done(message.port);
				else fail(new Error(`server failed: ${message.message}`));
			}
			buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
		});
		child.once("exit", (code) => fail(new Error(`server exited with code ${code}`)));
	});

	const checks: [string, number, number][] = [
		["the app's request", await status(port, { host: `${HOST}:${port}`, [TOKEN_HEADER]: token }), 200],
		["no token", await status(port, { host: `${HOST}:${port}` }), 403],
		["foreign Host", await status(port, { host: "evil.test", [TOKEN_HEADER]: token }), 403],
	];
	for (const [name, got, want] of checks) {
		console.log(`${got === want ? "ok  " : "FAIL"} ${name}: ${got} (want ${want})`);
		if (got !== want) failed = true;
	}
} catch (err) {
	console.error(err);
	failed = true;
} finally {
	child.kill();
	await new Promise((done) => setTimeout(done, 500));
	rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
