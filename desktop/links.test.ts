import { describe, expect, test } from "bun:test";
import { linkArg, linkPath, MAX_LINK, userChoiceProgId, windowsMailRegistration } from "./links";

describe("linkPath", () => {
	test.each([
		["raven://open/overview", "/overview"],
		["raven://open/overview/", "/overview"],
		["raven://open/mail", "/mail"],
		["raven://open/mail?folder=INBOX&uid=52332", "/mail?folder=INBOX&uid=52332"],
		["raven://open/mail/?folder=Work%2FClients&uid=7", "/mail?folder=Work%2FClients&uid=7"],
		["RAVEN://open/mail?mid=%3Cabc%40x.example%3E", "/mail?mid=%3Cabc%40x.example%3E"],
	])("%p → %p", (link, path) => {
		expect(linkPath(link)).toBe(path);
	});

	test("a mailto link opens compose with the whole link", () => {
		const link = "mailto:sam@x.example?subject=Hi%20there&body=a%26b";
		expect(linkPath(link)).toBe(`/mail?compose=${encodeURIComponent(link)}`);
		expect(linkPath("MAILTO:sam@x.example")).toBe(`/mail?compose=${encodeURIComponent("MAILTO:sam@x.example")}`);
	});

	test.each([
		"raven://evil",
		"raven://open",
		"raven://open/",
		"raven://open/settings",
		"raven://open/settings/../x",
		"raven://open/../settings",
		"raven://open/mail/../settings",
		"raven://open/%6Dail",
		"raven://open/Mail",
		"raven://open/mail#x",
		"raven://open//evil.test",
		"raven://open/mail?compose=mailto:a@x.example",
		"raven://open/mail?folder=INBOX&folder=Spam",
		"raven://open/overview?folder=INBOX",
		"raven://other/mail",
		"raven://user@open/mail",
		"raven:open/mail",
		"https://raven.example/open?to=raven://open/mail",
		"file:///C:/Windows/System32/calc.exe",
		"javascript:alert(1)",
		"",
	])("%p is dropped", (link) => {
		expect(linkPath(link)).toBeNull();
	});

	test("links over the size limit are dropped", () => {
		expect(linkPath(`mailto:a@x.example?body=${"a".repeat(MAX_LINK)}`)).toBeNull();
	});
});

describe("linkArg", () => {
	test("finds the link wherever it sits", () => {
		expect(linkArg(["C:\\Raven\\Raven.exe", "raven://open/overview"])).toBe("raven://open/overview");
		expect(linkArg(["raven.exe", "--allow-file-access-from-files", "MAILTO:a@x.example", "--flag"])).toBe("MAILTO:a@x.example");
	});

	test("a plain start has no link; other schemes aren't links", () => {
		expect(linkArg(["electron.exe", "D:\\repo\\desktop\\.stage\\app", "--raven-mode=preview"])).toBeUndefined();
		expect(linkArg(["Raven.exe", "javascript:alert(1)", "https://x.example"])).toBeUndefined();
	});
});

describe("windowsMailRegistration", () => {
	const commands = windowsMailRegistration({
		name: "Raven",
		key: "Raven",
		progId: "Raven.mailto",
		exe: "C:\\Users\\sam\\AppData\\Local\\Programs\\raven\\Raven.exe",
		args: [],
	});

	test("registers a ProgId whose command passes the link quoted", () => {
		expect(commands).toContainEqual([
			"add",
			"HKCU\\Software\\Classes\\Raven.mailto\\shell\\open\\command",
			"/ve",
			"/d",
			'"C:\\Users\\sam\\AppData\\Local\\Programs\\raven\\Raven.exe" "%1"',
			"/f",
		]);
		expect(commands).toContainEqual(["add", "HKCU\\Software\\Classes\\Raven.mailto", "/v", "URL Protocol", "/d", "", "/f"]);
	});

	test("lists Raven for mailto in Default apps, all under HKCU", () => {
		expect(commands).toContainEqual(["add", "HKCU\\Software\\Raven\\Capabilities\\URLAssociations", "/v", "mailto", "/d", "Raven.mailto", "/f"]);
		expect(commands).toContainEqual(["add", "HKCU\\Software\\RegisteredApplications", "/v", "Raven", "/d", "Software\\Raven\\Capabilities", "/f"]);
		expect(commands.every((args) => args[0] === "add" && args[1]!.startsWith("HKCU\\Software\\") && args.at(-1) === "/f")).toBe(true);
		// Never the mailto class itself: that would take the default without asking.
		expect(commands.some((args) => /\\Classes\\mailto/i.test(args[1]!))).toBe(false);
	});

	test("preview passes its app folder and mode before the link", () => {
		const preview = windowsMailRegistration({
			name: "Raven Preview",
			key: "RavenPreview",
			progId: "RavenPreview.mailto",
			exe: "D:\\repo\\desktop\\node_modules\\electron\\dist\\electron.exe",
			args: ["D:\\repo\\desktop\\.stage\\app", "--raven-mode=preview"],
		});
		expect(preview.find((args) => args[1]!.endsWith("\\command"))?.[4]).toBe(
			'"D:\\repo\\desktop\\node_modules\\electron\\dist\\electron.exe" "D:\\repo\\desktop\\.stage\\app" "--raven-mode=preview" "%1"',
		);
	});
});

describe("userChoiceProgId", () => {
	test("reads the ProgId from reg query output", () => {
		const output = "\r\nHKEY_CURRENT_USER\\Software\\...\\mailto\\UserChoice\r\n    ProgId    REG_SZ    Raven.mailto\r\n\r\n";
		expect(userChoiceProgId(output)).toBe("Raven.mailto");
	});

	test("no choice", () => {
		expect(userChoiceProgId("ERROR: The system was unable to find the specified registry key or value.")).toBeNull();
	});
});
