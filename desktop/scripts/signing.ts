/*
 * How an installer build signs, picked from the environment. With no keys
 * the build is exactly what it was before signing existed: an ad-hoc
 * signature on macOS (Apple Silicon won't run an unsigned app) and nothing on
 * Windows or Linux. Only the mode is ever logged, never a value.
 *
 * electron-builder reads its keys from the environment, and on Windows it
 * falls back from WIN_CSC_LINK to CSC_LINK. So each build gets only its own
 * OS's keys, and no token it could publish with.
 */

export type SigningMode = "mac-developer-id" | "mac-ad-hoc" | "win-azure" | "win-certificate" | "win-unsigned" | "linux-unsigned";

export type SigningPlan = {
	mode: SigningMode;
	/** Real signing (not ad hoc): the updater may install updates itself on macOS. */
	signed: boolean;
	/** macOS only: notarized with an App Store Connect API key. */
	notarize: boolean;
	/** Extra `-c.` overrides for electron-builder. */
	args: string[];
	/** The environment to run electron-builder with. */
	env: Record<string, string | undefined>;
};

export type SigningInput = {
	platform: NodeJS.Platform;
	env: Record<string, string | undefined>;
	/** The entitlements file for hardened-runtime builds. */
	entitlements: string;
	fileExists(path: string): boolean;
};

/** Every variable electron-builder (or a publisher) reads keys or tokens from. */
export const SIGNING_ENV = [
	"CSC_LINK",
	"CSC_KEY_PASSWORD",
	"CSC_NAME",
	"CSC_KEYCHAIN",
	"CSC_INSTALLER_LINK",
	"CSC_INSTALLER_KEY_PASSWORD",
	"WIN_CSC_LINK",
	"WIN_CSC_KEY_PASSWORD",
	"APPLE_API_KEY",
	"APPLE_API_KEY_ID",
	"APPLE_API_ISSUER",
	"APPLE_ID",
	"APPLE_APP_SPECIFIC_PASSWORD",
	"APPLE_TEAM_ID",
	"APPLE_KEYCHAIN",
	"APPLE_KEYCHAIN_PROFILE",
	"AZURE_TENANT_ID",
	"AZURE_CLIENT_ID",
	"AZURE_CLIENT_SECRET",
	"AZURE_CLIENT_CERTIFICATE_PATH",
	"AZURE_CLIENT_CERTIFICATE_PASSWORD",
	"AZURE_USERNAME",
	"AZURE_PASSWORD",
	"RAVEN_AZURE_ENDPOINT",
	"RAVEN_AZURE_ACCOUNT",
	"RAVEN_AZURE_CERT_PROFILE",
	"RAVEN_AZURE_PUBLISHER_NAME",
	"GH_TOKEN",
	"GITHUB_TOKEN",
];

const APPLE_NOTARY = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];
const AZURE = ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "RAVEN_AZURE_ENDPOINT", "RAVEN_AZURE_ACCOUNT", "RAVEN_AZURE_CERT_PROFILE", "RAVEN_AZURE_PUBLISHER_NAME"];

export function signingPlan({ platform, env, entitlements, fileExists }: SigningInput): SigningPlan {
	const given = (name: string) => (env[name] ?? "").trim() !== "";
	const clean: Record<string, string | undefined> = { ...env };
	for (const name of SIGNING_ENV) delete clean[name];
	delete clean.CSC_FOR_PULL_REQUEST;
	const pass = (names: string[]) => {
		for (const name of names) if (given(name)) clean[name] = env[name];
	};
	const missing = (names: string[]) => names.filter((name) => !given(name));

	if (platform === "darwin") {
		if (!given("CSC_LINK")) {
			// electron-builder skips all signing on pull requests (GITHUB_BASE_REF), ad hoc too,
			// so a PR would build an app a tag never ships. Its worry is keys reaching fork PRs,
			// and an ad-hoc build has none.
			clean.CSC_FOR_PULL_REQUEST = "true";
			return { mode: "mac-ad-hoc", signed: false, notarize: false, args: ["-c.mac.identity=-"], env: clean };
		}
		pass(["CSC_LINK", "CSC_KEY_PASSWORD"]);
		const notaryGiven = APPLE_NOTARY.filter(given);
		if (notaryGiven.length > 0 && notaryGiven.length < APPLE_NOTARY.length) {
			throw new Error(`notarizing needs all of ${APPLE_NOTARY.join(", ")}; missing ${missing(APPLE_NOTARY).join(", ")}`);
		}
		const notarize = notaryGiven.length === APPLE_NOTARY.length;
		if (notarize && !fileExists(env.APPLE_API_KEY ?? "")) throw new Error("APPLE_API_KEY must be the path of the .p8 key file, and it doesn't exist");
		if (notarize) pass(APPLE_NOTARY);
		return {
			mode: "mac-developer-id",
			signed: true,
			notarize,
			args: ["-c.mac.hardenedRuntime=true", `-c.mac.entitlements=${entitlements}`, `-c.mac.entitlementsInherit=${entitlements}`, `-c.mac.notarize=${notarize}`],
			env: clean,
		};
	}

	if (platform === "win32") {
		const azure = given("AZURE_TENANT_ID") || given("RAVEN_AZURE_ENDPOINT");
		const certificate = given("WIN_CSC_LINK");
		if (azure && certificate) throw new Error("both Azure Trusted Signing and WIN_CSC_LINK are set; keep one");
		if (azure) {
			const absent = missing(AZURE);
			if (absent.length > 0) throw new Error(`Azure Trusted Signing needs ${absent.join(", ")}`);
			pass(AZURE);
			return {
				mode: "win-azure",
				signed: true,
				notarize: false,
				args: [
					`-c.win.azureSignOptions.publisherName=${env.RAVEN_AZURE_PUBLISHER_NAME}`,
					`-c.win.azureSignOptions.endpoint=${env.RAVEN_AZURE_ENDPOINT}`,
					`-c.win.azureSignOptions.codeSigningAccountName=${env.RAVEN_AZURE_ACCOUNT}`,
					`-c.win.azureSignOptions.certificateProfileName=${env.RAVEN_AZURE_CERT_PROFILE}`,
					"-c.win.azureSignOptions.fileDigest=SHA256",
					"-c.win.azureSignOptions.timestampDigest=SHA256",
					"-c.win.azureSignOptions.timestampRfc3161=http://timestamp.acs.microsoft.com",
				],
				env: clean,
			};
		}
		if (certificate) {
			pass(["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"]);
			return { mode: "win-certificate", signed: true, notarize: false, args: [], env: clean };
		}
		// No publisher name goes into app-update.yml, so the updater doesn't expect a signature either.
		return { mode: "win-unsigned", signed: false, notarize: false, args: ["-c.win.verifyUpdateCodeSignature=false"], env: clean };
	}

	return { mode: "linux-unsigned", signed: false, notarize: false, args: [], env: clean };
}

/**
 * What's wrong with a macOS app's signature for this mode, given what
 * `codesign --display --verbose=2` prints (build.ts runs it). The seal can be
 * valid and still be the wrong one: electron-builder matches the ad-hoc
 * identity "-" against keychain certificate names (RELEASING.md), and a
 * Developer ID build must carry that certificate, not a different one.
 */
export function macSignatureProblem(mode: SigningMode, display: string): string | undefined {
	if (mode === "mac-ad-hoc" && !/^Signature=adhoc$/m.test(display)) {
		return "the build asked for an ad-hoc signature, but codesign doesn't show Signature=adhoc (did a keychain certificate match \"-\"?)";
	}
	if (mode === "mac-developer-id" && !/^Authority=Developer ID Application: /m.test(display)) {
		return "the build asked for a Developer ID signature, but codesign shows no \"Developer ID Application\" authority";
	}
	return undefined;
}

export const MODE_LABEL: Record<SigningMode, string> = {
	"mac-developer-id": "signed with a Developer ID",
	"mac-ad-hoc": "ad hoc (no Developer ID keys)",
	"win-azure": "signed with Azure Trusted Signing",
	"win-certificate": "signed with a certificate (WIN_CSC_LINK)",
	"win-unsigned": "unsigned (no signing keys)",
	"linux-unsigned": "unsigned (Linux packages aren't signed)",
};
