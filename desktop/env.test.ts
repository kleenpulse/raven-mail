import { describe, expect, test } from "bun:test";
import { baseEnv, parsePortRecord, portRecord, serverEnv } from "./env";

const PARENT = {
	SystemRoot: "C:\\Windows",
	Path: "C:\\Windows\\system32",
	TEMP: "C:\\Temp",
	USERPROFILE: "C:\\Users\\me",
	LC_ALL: "en_GB.UTF-8",
	NODE_OPTIONS: "--require evil.js",
	DATABASE_URL: "postgres://neon",
	SESSION_SECRET: "from-a-dev-shell-0123456789abcdef0123",
	TYPESAFE_API_KEY: "sk-shell",
	__NEXT_PRIVATE_STANDALONE_CONFIG: "{}",
	EMPTY: undefined,
};

describe("baseEnv", () => {
	test("keeps only the allowlist, whatever the casing", () => {
		expect(baseEnv(PARENT)).toEqual({
			SystemRoot: "C:\\Windows",
			Path: "C:\\Windows\\system32",
			TEMP: "C:\\Temp",
			USERPROFILE: "C:\\Users\\me",
			LC_ALL: "en_GB.UTF-8",
		});
	});
});

describe("serverEnv", () => {
	test("production: no shell secrets, NODE_ENV set, loopback mail allowed", () => {
		const env = serverEnv(PARENT, { mode: "prod", port: 52731, token: "t0k" });
		expect(env.NODE_ENV).toBe("production");
		expect(env.PORT).toBe("52731");
		expect(env.RAVEN_DESKTOP_TOKEN).toBe("t0k");
		expect(env.ALLOW_LOOPBACK_MAIL_HOSTS).toBe("true");
		expect(env.NEXT_TELEMETRY_DISABLED).toBe("1");
		for (const key of ["NODE_OPTIONS", "DATABASE_URL", "SESSION_SECRET", "TYPESAFE_API_KEY", "__NEXT_PRIVATE_STANDALONE_CONFIG"]) {
			expect(env[key]).toBeUndefined();
		}
	});

	test("dev: blanks DATABASE_URL so .env's Neon URL can't fill it, leaves NODE_ENV to next dev", () => {
		const env = serverEnv(PARENT, { mode: "dev", port: 52800, token: "t0k" });
		expect(env.DATABASE_URL).toBe("");
		expect(env.NODE_ENV).toBeUndefined();
		expect(env.RAVEN_DESKTOP_BUILD).toBe("1");
	});
});

describe("port record", () => {
	test("round-trips", () => {
		expect(parsePortRecord(portRecord(52731))).toBe(52731);
	});

	test("rejects missing, broken or out-of-range values", () => {
		for (const text of [null, "", "{", "{}", '{"port":"52731"}', '{"port":80}', '{"port":70000}', '{"port":5.5}']) {
			expect(parsePortRecord(text)).toBeNull();
		}
	});
});
