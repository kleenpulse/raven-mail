import { describe, expect, test } from "bun:test";
import { getProvider, PROVIDERS } from "@/lib/providers";
import { describeLoginFailure, serverDetail } from "./login-errors";

const gmail = getProvider("gmail");
const custom = getProvider("custom");

/** nodemailer's shape for the rejection in the original bug report. */
const GMAIL_SMTP_534 = Object.assign(
	new Error(
		"Invalid login: 534-5.7.9 Application-specific password required. For more information, go to\n534 5.7.9  https://support.google.com/mail/?p=InvalidSecondFactor a640c23a62f3a-c2ae757b4cdsm148147366b.28 - gsmtp",
	),
	{
		code: "EAUTH",
		responseCode: 534,
		command: "AUTH PLAIN",
		response:
			"534-5.7.9 Application-specific password required. For more information, go to\n534 5.7.9  https://support.google.com/mail/?p=InvalidSecondFactor a640c23a62f3a-c2ae757b4cdsm148147366b.28 - gsmtp",
	},
);

/** imapflow's shape: `authenticationFailed` plus the server's text. */
const imapAuth = (responseText: string) =>
	Object.assign(new Error("Command failed"), { authenticationFailed: true, serverResponseCode: "AUTHENTICATIONFAILED", responseText });

const net = (code: string) => Object.assign(new Error(`connect ${code}`), { code });

describe("describeLoginFailure", () => {
	test("Gmail SMTP 534-5.7.9 → app password required, pointing at the password field", () => {
		const f = describeLoginFailure(GMAIL_SMTP_534, "smtp", gmail);
		expect(f.code).toBe("app_password_required");
		expect(f.error).toBe("Gmail needs an app password, not your regular password.");
		expect(f.field).toBe("password");
		expect(f.help?.href).toBe("https://myaccount.google.com/apppasswords");
		expect(f.detail).toContain("534-5.7.9");
		expect(f.error).not.toContain("gsmtp");
	});

	test("Gmail IMAP [ALERT] application-specific password → same answer from the read side", () => {
		const f = describeLoginFailure(
			imapAuth("[ALERT] Application-specific password required: https://support.google.com/accounts/answer/185833 (Failure)"),
			"imap",
			gmail,
		);
		expect(f.code).toBe("app_password_required");
	});

	test("a wrong app password reads as rejected, and says the regular password won't work", () => {
		const f = describeLoginFailure(imapAuth("[AUTHENTICATIONFAILED] Invalid credentials (Failure)"), "imap", gmail);
		expect(f.code).toBe("auth_failed");
		expect(f.error).toBe("Gmail didn't accept that email and app password.");
		expect(f.hint).toContain("regular password won't work");
		expect(f.field).toBe("password");
	});

	test("nodemailer EAUTH 535 on a custom server stays generic", () => {
		const err = Object.assign(new Error("Invalid login: 535 Authentication failed"), { code: "EAUTH", responseCode: 535 });
		const f = describeLoginFailure(err, "smtp", custom);
		expect(f.code).toBe("auth_failed");
		expect(f.error).toBe("The mail server didn't accept that email and password.");
		expect(f.help).toBeUndefined();
	});

	test("Gmail 5.7.14 web-login challenge", () => {
		const err = Object.assign(new Error("Invalid login: 534-5.7.14 <https://accounts.google.com/signin/continue?...> Please log in via your web browser"), {
			code: "EAUTH",
			responseCode: 534,
		});
		const f = describeLoginFailure(err, "smtp", gmail);
		expect(f.code).toBe("web_login_required");
		expect(f.hint).toContain("browser");
	});

	test("Microsoft basic-auth block", () => {
		const f = describeLoginFailure(imapAuth("AUTHENTICATE failed. BasicAuthBlocked"), "imap", getProvider("outlook"));
		expect(f.code).toBe("basic_auth_blocked");
		expect(f.error).toContain("Outlook / Microsoft 365");
	});

	test("DNS failure on a custom host flags the server fields", () => {
		const f = describeLoginFailure(net("ENOTFOUND"), "imap", custom);
		expect(f.code).toBe("server_unreachable");
		expect(f.field).toBe("server");
		expect(f.hint).toContain("host");
	});

	test("SMTP unreachable says it's the outgoing server", () => {
		const f = describeLoginFailure(Object.assign(new Error("Connection closed"), { code: "ECONNECTION" }), "smtp", gmail);
		expect(f.code).toBe("server_unreachable");
		expect(f.error).toBe("Couldn't reach the outgoing (SMTP) server.");
	});

	test("Proton refused → remind that Bridge must be running", () => {
		const f = describeLoginFailure(net("ECONNREFUSED"), "imap", getProvider("proton"));
		expect(f.code).toBe("server_unreachable");
		expect(f.hint).toContain("Proton Bridge is running");
	});

	test("timeouts", () => {
		const f = describeLoginFailure(Object.assign(new Error("Greeting never received"), { code: "ETIMEDOUT" }), "smtp", gmail);
		expect(f.code).toBe("timeout");
		expect(f.error).toBe("Gmail didn't answer in time.");
	});

	test("anything else never leaks raw protocol text into the headline", () => {
		const f = describeLoginFailure(new Error("* BYE internal server error 0xDEAD"), "imap", gmail);
		expect(f.code).toBe("unknown");
		expect(f.error).not.toContain("BYE");
		expect(f.detail).toContain("BYE");
	});
});

test("serverDetail collapses whitespace and caps length", () => {
	expect(serverDetail({ response: "a\n\n  b" })).toBe("a b");
	expect(serverDetail({ message: "x".repeat(500) })).toHaveLength(300);
	expect(serverDetail({})).toBeUndefined();
});

test("app-password providers say so in their hint", () => {
	for (const p of PROVIDERS.filter((p) => p.password.kind === "app")) {
		expect(p.hint.toLowerCase()).toContain("app");
		expect(p.hint.toLowerCase()).toContain("password");
	}
	expect(gmail.password.kind).toBe("app");
	expect(custom.password.kind).toBe("account");
});
