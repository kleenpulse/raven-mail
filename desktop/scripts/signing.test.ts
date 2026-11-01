import { describe, expect, test } from "bun:test";
import { MODE_LABEL, macSignatureProblem, signingPlan, type SigningInput, type SigningMode } from "./signing";

const ENTITLEMENTS = "/repo/desktop/build/entitlements.hardened.plist";
const plan = (platform: NodeJS.Platform, env: Record<string, string | undefined>, exists = true) =>
	signingPlan({ platform, env, entitlements: ENTITLEMENTS, fileExists: () => exists } satisfies SigningInput);

const MAC_KEYS = { CSC_LINK: "base64-p12", CSC_KEY_PASSWORD: "pw" };
const NOTARY = { APPLE_API_KEY: "/tmp/key.p8", APPLE_API_KEY_ID: "KEYID", APPLE_API_ISSUER: "issuer-uuid" };
const AZURE = {
	AZURE_TENANT_ID: "tenant",
	AZURE_CLIENT_ID: "client",
	AZURE_CLIENT_SECRET: "secret",
	RAVEN_AZURE_ENDPOINT: "https://eus.codesigning.azure.net",
	RAVEN_AZURE_ACCOUNT: "raven",
	RAVEN_AZURE_CERT_PROFILE: "raven-public",
	RAVEN_AZURE_PUBLISHER_NAME: "Raven Contributors",
};

describe("with no keys, builds as before", () => {
	test("macOS signs ad hoc, with no hardened runtime or notarizing", () => {
		const result = plan("darwin", { PATH: "/bin" });
		expect(result).toMatchObject({ mode: "mac-ad-hoc", signed: false, notarize: false, args: ["-c.mac.identity=-"] });
		expect(result.env.PATH).toBe("/bin");
	});

	test("macOS signs ad hoc on pull requests too, where electron-builder would skip it", () => {
		expect(plan("darwin", { GITHUB_BASE_REF: "main" }).env.CSC_FOR_PULL_REQUEST).toBe("true");
	});

	test("Windows stays unsigned, and its updater won't expect a signature", () => {
		expect(plan("win32", {})).toMatchObject({ mode: "win-unsigned", signed: false, args: ["-c.win.verifyUpdateCodeSignature=false"] });
	});

	test("Linux is never signed", () => {
		expect(plan("linux", { ...MAC_KEYS, ...AZURE })).toMatchObject({ mode: "linux-unsigned", signed: false, args: [] });
	});

	test("empty variables count as missing (a secret that isn't set)", () => {
		expect(plan("darwin", { CSC_LINK: "", APPLE_API_KEY_ID: " " }).mode).toBe("mac-ad-hoc");
		expect(plan("win32", { AZURE_TENANT_ID: "", WIN_CSC_LINK: "" }).mode).toBe("win-unsigned");
	});
});

describe("macOS", () => {
	test("a Developer ID turns on the hardened runtime with Raven's entitlements", () => {
		const result = plan("darwin", MAC_KEYS);
		expect(result).toMatchObject({ mode: "mac-developer-id", signed: true, notarize: false });
		expect(result.args).toEqual(["-c.mac.hardenedRuntime=true", `-c.mac.entitlements=${ENTITLEMENTS}`, `-c.mac.entitlementsInherit=${ENTITLEMENTS}`, "-c.mac.notarize=false"]);
		expect(result.env.CSC_LINK).toBe("base64-p12");
	});

	test("notarizes when all three API key values are there", () => {
		const result = plan("darwin", { ...MAC_KEYS, ...NOTARY });
		expect(result.notarize).toBe(true);
		expect(result.args).toContain("-c.mac.notarize=true");
		expect(result.env.APPLE_API_KEY).toBe("/tmp/key.p8");
	});

	test("a partial notary setup fails, naming only what's missing", () => {
		expect(() => plan("darwin", { ...MAC_KEYS, APPLE_API_KEY_ID: "KEYID" })).toThrow("missing APPLE_API_KEY, APPLE_API_ISSUER");
	});

	test("the API key must be a file", () => {
		expect(() => plan("darwin", { ...MAC_KEYS, ...NOTARY }, false)).toThrow("APPLE_API_KEY must be the path");
	});

	test("Windows and Apple ID notary values never reach the build", () => {
		const env = plan("darwin", { ...MAC_KEYS, WIN_CSC_LINK: "x", APPLE_ID: "a", APPLE_APP_SPECIFIC_PASSWORD: "b", ...AZURE }).env;
		for (const name of ["WIN_CSC_LINK", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", ...Object.keys(AZURE)]) expect(env[name]).toBeUndefined();
	});
});

describe("Windows", () => {
	test("Azure Trusted Signing passes its names as azureSignOptions", () => {
		const result = plan("win32", AZURE);
		expect(result).toMatchObject({ mode: "win-azure", signed: true });
		expect(result.args).toContain("-c.win.azureSignOptions.publisherName=Raven Contributors");
		expect(result.args).toContain("-c.win.azureSignOptions.endpoint=https://eus.codesigning.azure.net");
		expect(result.args).toContain("-c.win.azureSignOptions.codeSigningAccountName=raven");
		expect(result.args).toContain("-c.win.azureSignOptions.certificateProfileName=raven-public");
		expect(result.args).toContain("-c.win.azureSignOptions.timestampRfc3161=http://timestamp.acs.microsoft.com");
		expect(result.args.some((arg) => arg.includes("verifyUpdateCodeSignature"))).toBe(false);
		expect(result.env.AZURE_CLIENT_SECRET).toBe("secret");
	});

	test("a partial Azure setup fails, naming what's missing", () => {
		expect(() => plan("win32", { AZURE_TENANT_ID: "tenant", RAVEN_AZURE_ENDPOINT: "e" })).toThrow(
			"Azure Trusted Signing needs AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, RAVEN_AZURE_ACCOUNT, RAVEN_AZURE_CERT_PROFILE, RAVEN_AZURE_PUBLISHER_NAME",
		);
	});

	test("a certificate signs through electron-builder's own signtool", () => {
		const result = plan("win32", { WIN_CSC_LINK: "base64-pfx", WIN_CSC_KEY_PASSWORD: "pw" });
		expect(result).toMatchObject({ mode: "win-certificate", signed: true, args: [] });
		expect(result.env.WIN_CSC_LINK).toBe("base64-pfx");
	});

	test("both ways at once is a mistake", () => {
		expect(() => plan("win32", { ...AZURE, WIN_CSC_LINK: "x" })).toThrow("keep one");
	});

	test("the Apple certificate never reaches the Windows build (signtool falls back to CSC_LINK)", () => {
		for (const env of [MAC_KEYS, { ...MAC_KEYS, WIN_CSC_LINK: "pfx" }, { ...MAC_KEYS, ...AZURE }]) {
			expect(plan("win32", env).env.CSC_LINK).toBeUndefined();
			expect(plan("win32", env).env.CSC_KEY_PASSWORD).toBeUndefined();
		}
	});
});

test("only the ad-hoc build may sign a pull request", () => {
	const cases: [NodeJS.Platform, Record<string, string>, SigningMode][] = [
		["darwin", MAC_KEYS, "mac-developer-id"],
		["darwin", { ...MAC_KEYS, ...NOTARY }, "mac-developer-id"],
		["win32", AZURE, "win-azure"],
		["win32", { WIN_CSC_LINK: "base64-pfx", WIN_CSC_KEY_PASSWORD: "pw" }, "win-certificate"],
		["win32", {}, "win-unsigned"],
		["linux", {}, "linux-unsigned"],
	];
	// A new mode has to be added here.
	expect(new Set<string>(cases.map(([, , mode]) => mode))).toEqual(new Set(Object.keys(MODE_LABEL).filter((mode) => mode !== "mac-ad-hoc")));
	for (const [platform, env, mode] of cases) {
		const result = plan(platform, { ...env, CSC_FOR_PULL_REQUEST: "true" });
		expect(result.mode).toBe(mode);
		expect(result.env.CSC_FOR_PULL_REQUEST).toBeUndefined();
	}
});

describe("the macOS signature matches the mode", () => {
	const head = ["Executable=/out/mac-arm64/Raven.app/Contents/MacOS/Raven", "Identifier=io.github.kleenpulse.raven", "Format=app bundle with Mach-O thin (arm64)"];
	const tail = ["Info.plist entries=30", "Sealed Resources version=2 rules=13 files=412", "Internal requirements count=1 size=180"];
	const display = (...lines: string[]) => [...head, ...lines, ...tail].join("\n");
	const AD_HOC = display("CodeDirectory v=20400 size=5321 flags=0x2(adhoc) hashes=155+7 location=embedded", "Signature=adhoc", "TeamIdentifier=not set");
	const DEVELOPER_ID = display(
		"CodeDirectory v=20500 size=5385 flags=0x10000(runtime) hashes=155+7 location=embedded",
		"Signature size=9046",
		"Authority=Developer ID Application: Raven Contributors (ABCDE12345)",
		"Authority=Developer ID Certification Authority",
		"Authority=Apple Root CA",
		"Timestamp=1 Nov 2026 at 12:00:00",
		"TeamIdentifier=ABCDE12345",
	);
	// A keychain certificate with a "-" in its name, picked instead of the ad-hoc identity.
	const KEYCHAIN_MATCH = display(
		"CodeDirectory v=20400 size=5385 flags=0x0(none) hashes=155+7 location=embedded",
		"Signature size=4790",
		"Authority=Apple Development: Sam Lee-Park (FGHIJ67890)",
		"Authority=Apple Worldwide Developer Relations Certification Authority",
		"Authority=Apple Root CA",
		"TeamIdentifier=KLMNO12345",
	);

	test("an ad-hoc build must show Signature=adhoc", () => {
		expect(macSignatureProblem("mac-ad-hoc", AD_HOC)).toBeUndefined();
		expect(macSignatureProblem("mac-ad-hoc", KEYCHAIN_MATCH)).toContain("Signature=adhoc");
		expect(macSignatureProblem("mac-ad-hoc", DEVELOPER_ID)).toContain("Signature=adhoc");
		expect(macSignatureProblem("mac-ad-hoc", "")).toContain("Signature=adhoc");
	});

	test("the flag in CodeDirectory alone isn't enough", () => {
		expect(macSignatureProblem("mac-ad-hoc", display("CodeDirectory v=20400 size=5321 flags=0x2(adhoc) hashes=155+7 location=embedded"))).toBeDefined();
	});

	test("a Developer ID build must carry a Developer ID Application authority", () => {
		expect(macSignatureProblem("mac-developer-id", DEVELOPER_ID)).toBeUndefined();
		expect(macSignatureProblem("mac-developer-id", AD_HOC)).toContain("Developer ID Application");
		expect(macSignatureProblem("mac-developer-id", KEYCHAIN_MATCH)).toContain("Developer ID Application");
	});

	test("Signature=adhoc has to be a whole line, not part of another value", () => {
		expect(macSignatureProblem("mac-ad-hoc", display("Identifier=Signature=adhoc"))).toBeDefined();
	});

	test("other modes aren't macOS builds and aren't checked here", () => {
		for (const mode of ["win-azure", "win-certificate", "win-unsigned", "linux-unsigned"] as const) expect(macSignatureProblem(mode, "")).toBeUndefined();
	});
});

test("no build gets a token it could publish with", () => {
	for (const platform of ["darwin", "win32", "linux"] as const) {
		const env = plan(platform, { GH_TOKEN: "t", GITHUB_TOKEN: "t", ...MAC_KEYS }).env;
		expect(env.GH_TOKEN).toBeUndefined();
		expect(env.GITHUB_TOKEN).toBeUndefined();
	}
});
