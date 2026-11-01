import { describe, expect, test } from "bun:test";
import { parseBuildInfo, releasePage, updateMode, type UpdateContext } from "./update-policy";

const ctx = (over: Partial<UpdateContext> = {}): UpdateContext => ({ packaged: true, platform: "win32", signed: false, appImage: false, ...over });

describe("how each build updates", () => {
	test("dev and preview runs never update", () => {
		for (const platform of ["win32", "darwin", "linux"] as const) expect(updateMode(ctx({ packaged: false, platform, signed: true, appImage: true }))).toBe("off");
	});

	test("Windows installs updates itself, signed or not", () => {
		expect(updateMode(ctx())).toBe("auto");
		expect(updateMode(ctx({ signed: true }))).toBe("auto");
	});

	test("macOS installs them only once signed; ad hoc builds point to the release", () => {
		expect(updateMode(ctx({ platform: "darwin", signed: true }))).toBe("auto");
		expect(updateMode(ctx({ platform: "darwin" }))).toBe("notify");
	});

	test("an AppImage replaces itself; a .deb points to the release", () => {
		expect(updateMode(ctx({ platform: "linux", appImage: true }))).toBe("auto");
		expect(updateMode(ctx({ platform: "linux" }))).toBe("notify");
	});

	test("other systems don't update", () => {
		expect(updateMode(ctx({ platform: "freebsd" }))).toBe("off");
	});
});

describe("the release page", () => {
	test("links to the version's tag", () => {
		expect(releasePage("0.10.0")).toBe("https://github.com/kleenpulse/raven-mail/releases/tag/v0.10.0");
		expect(releasePage("1.2.3-beta.1")).toBe("https://github.com/kleenpulse/raven-mail/releases/tag/v1.2.3-beta.1");
	});

	test("falls back to the latest release for anything that isn't a version", () => {
		for (const version of ["../../evil", "1.2", "1.2.3/../../x", "1.2.3?x=1", "", null, 3]) {
			expect(releasePage(version)).toBe("https://github.com/kleenpulse/raven-mail/releases/latest");
		}
	});
});

describe("the build info", () => {
	test("reads ravenBuild.signed", () => {
		expect(parseBuildInfo(JSON.stringify({ name: "raven", ravenBuild: { signed: true } }))).toEqual({ signed: true });
		expect(parseBuildInfo(JSON.stringify({ ravenBuild: { signed: false } }))).toEqual({ signed: false });
	});

	test("treats anything else as unsigned", () => {
		for (const text of [null, "", "{", "{}", JSON.stringify({ ravenBuild: { signed: "true" } }), JSON.stringify({ ravenBuild: null })]) {
			expect(parseBuildInfo(text)).toEqual({ signed: false });
		}
	});
});
