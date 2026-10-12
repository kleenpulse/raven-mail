import { getProvider, type ProviderId } from "@/lib/providers";
import type { MailSession } from "@/lib/session";

export type LoginFields = {
  provider: ProviderId;
  email: string;
  password: string;
  displayName?: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
};

/**
 * Presets own their endpoints outright. Only the custom provider reads the
 * host/port/TLS fields — the old `?? preset` merge let an absent checkbox
 * (coerced to `false`) switch Gmail & co. to plaintext on ports 993/465.
 */
export function buildSession(input: LoginFields, now = Date.now()): MailSession {
  const email = input.email.trim();
  const base = {
    email,
    displayName: input.displayName?.trim() || email.split("@")[0] || email,
    provider: input.provider,
    password: input.password,
    createdAt: now,
  };

  if (input.provider !== "custom") {
    const preset = getProvider(input.provider);
    return { ...base, imap: { ...preset.imap }, smtp: { ...preset.smtp } };
  }

  const imapHost = input.imapHost?.trim() ?? "";
  const smtpHost = input.smtpHost?.trim() ?? "";
  if (!imapHost || !smtpHost) {
    throw new Error("IMAP and SMTP hosts are required for a custom provider.");
  }
  return {
    ...base,
    imap: { host: imapHost, port: input.imapPort ?? 993, secure: input.imapSecure ?? true },
    smtp: { host: smtpHost, port: input.smtpPort ?? 465, secure: input.smtpSecure ?? true },
  };
}
