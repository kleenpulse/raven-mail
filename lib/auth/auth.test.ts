import { describe, expect, test } from "bun:test";
import { buildSession } from "@/lib/auth/build-session";
import { isLoopbackHost, isPrivateAddress } from "@/lib/auth/ip";

describe("buildSession", () => {
  test("presets ignore stray TLS/port fields (plaintext regression)", () => {
    const session = buildSession({
      provider: "gmail",
      email: " me@gmail.com ",
      password: "app-pass",
      imapSecure: false,
      smtpSecure: false,
      imapPort: 143,
    });
    expect(session.email).toBe("me@gmail.com");
    expect(session.imap).toEqual({ host: "imap.gmail.com", port: 993, secure: true });
    expect(session.smtp).toEqual({ host: "smtp.gmail.com", port: 465, secure: true });
    expect(session.displayName).toBe("me");
  });

  test("custom provider honors fields with TLS defaults", () => {
    const session = buildSession({
      provider: "custom",
      email: "a@b.io",
      password: "x",
      imapHost: "imap.b.io",
      smtpHost: "smtp.b.io",
      smtpPort: 587,
      smtpSecure: false,
    });
    expect(session.imap).toEqual({ host: "imap.b.io", port: 993, secure: true });
    expect(session.smtp).toEqual({ host: "smtp.b.io", port: 587, secure: false });
  });

  test("custom provider requires hosts", () => {
    expect(() => buildSession({ provider: "custom", email: "a@b.io", password: "x" })).toThrow();
  });
});

describe("ip classification", () => {
  test.each([
    ["10.0.0.1", true],
    ["172.20.1.1", true],
    ["192.168.1.10", true],
    ["127.0.0.1", true],
    ["169.254.169.254", true],
    ["100.64.0.1", true],
    ["::1", true],
    ["fd12:3456::1", true],
    ["fe80::1", true],
    ["::ffff:10.1.2.3", true],
    ["::ffff:7f00:1", true],
    ["64:ff9b::a9fe:a9fe", true],
    ["64:ff9b::10.0.0.1", true],
    ["ff02::1", true],
    ["64:ff9b::8efa:a6c", false],
    ["::7f00:1", true],
    ["::127.0.0.1", true],
    ["2002:7f00:1::1", true],
    ["2002:8efa:a6c::1", false],
    ["fec0::1", true],
    ["2001:db8::1", true],
    ["142.250.10.108", false],
    ["2a00:1450:4001::6d", false],
  ])("%s private=%p", (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });

  test("loopback hosts", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("localhost.")).toBe(true);
    expect(isLoopbackHost("imap.gmail.com")).toBe(false);
  });
});
