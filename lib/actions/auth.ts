"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { getProvider, type ProviderId } from "@/lib/providers";
import { clearSession, getSession, setSession, type MailSession } from "@/lib/session";
import { buildSession } from "@/lib/auth/build-session";
import { assertPublicMailHost } from "@/lib/auth/host-guard";
import { describeLoginFailure, type LoginFailure } from "@/lib/auth/login-errors";
import { verifyCredentials } from "@/lib/mail/imap";
import { verifySmtp } from "@/lib/mail/smtp";
import type { ActionResult } from "@/lib/mail/types";

const loginSchema = z.object({
  provider: z.enum(["gmail", "outlook", "yahoo", "icloud", "fastmail", "proton", "custom"]),
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  displayName: z.string().max(80).optional().default(""),
  imapHost: z.string().optional().default(""),
  imapPort: z.coerce.number().int().min(1).max(65535).optional(),
  imapSecure: z.boolean().optional(),
  smtpHost: z.string().optional().default(""),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
});

export type LoginInput = z.input<typeof loginSchema>;

export type LoginResult =
  | { ok: true; data: { email: string } }
  | ({ ok: false } & Omit<LoginFailure, "code"> & { code?: LoginFailure["code"] });

export async function loginAction(_prev: LoginResult | null, formData: FormData): Promise<LoginResult> {
  // Only the custom provider exposes server fields; presets never read them.
  const custom = formData.get("provider") === "custom";
  const field = (name: string) => (custom ? (formData.get(name) ?? undefined) : undefined);
  // Preset providers require generated app passwords, which are displayed in
  // spaced groups ("abcd efgh ijkl mnop") but never contain real whitespace.
  // Custom servers may use real passwords where spaces are significant.
  const rawPassword = formData.get("password");
  const password =
    !custom && typeof rawPassword === "string" ? rawPassword.replace(/\s+/g, "") : rawPassword;
  const parsed = loginSchema.safeParse({
    provider: formData.get("provider"),
    email: formData.get("email"),
    password,
    displayName: formData.get("displayName") ?? "",
    imapHost: field("imapHost") ?? "",
    imapPort: field("imapPort") || undefined,
    imapSecure: custom ? formData.get("imapSecure") === "on" : undefined,
    smtpHost: field("smtpHost") ?? "",
    smtpPort: field("smtpPort") || undefined,
    smtpSecure: custom ? formData.get("smtpSecure") === "on" : undefined,
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0] === "email" ? "email" : issue?.path[0] === "password" ? "password" : undefined;
    return { ok: false, error: issue?.message ?? "Check the form and try again.", field };
  }

  let session: MailSession;
  try {
    session = buildSession({ ...parsed.data, provider: parsed.data.provider as ProviderId });
    if (session.provider === "custom") {
      await Promise.all([
        assertPublicMailHost(session.imap.host),
        assertPublicMailHost(session.smtp.host),
      ]);
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid configuration.", field: "server" };
  }

  // Both sides are checked so the message can say which one failed; reading
  // (IMAP) is reported first since nothing works without it.
  const [imap, smtp] = await Promise.allSettled([verifyCredentials(session), verifySmtp(session)]);
  const failed =
    imap.status === "rejected"
      ? { side: "imap" as const, err: imap.reason }
      : smtp.status === "rejected"
        ? { side: "smtp" as const, err: smtp.reason }
        : null;
  if (failed) {
    const failure = describeLoginFailure(failed.err, failed.side, getProvider(session.provider));
    console.warn(`[login] ${session.provider} ${failed.side} ${failure.code}: ${failure.detail ?? "no detail"}`);
    return { ok: false, ...failure };
  }

  try {
    await setSession(session);
  } catch (err) {
    console.error("[login] could not write the session", err);
    return {
      ok: false,
      error: "Your mailbox connected, but Raven couldn't start a session.",
      hint: "The server is missing its session key (SESSION_SECRET). If you run this Raven, set it and redeploy.",
    };
  }
  return { ok: true, data: { email: session.email } };
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  redirect("/login");
}

export async function devLoginAction(): Promise<ActionResult<{ email: string }>> {
  if (process.env.NODE_ENV === "production") {
    return { ok: false, error: "Dev login is disabled in production." };
  }

  const session: MailSession = {
    email: "dev@localhost",
    displayName: "Dev User",
    provider: "custom",
    password: "",
    imap: { host: "dev.local", port: 993, secure: true },
    smtp: { host: "dev.local", port: 465, secure: true },
    createdAt: Date.now(),
    dev: true,
  };

  await setSession(session);
  return { ok: true, data: { email: session.email } };
}

export async function getSessionAction(): Promise<{
  email: string;
  displayName: string;
  provider: ProviderId;
} | null> {
  const session = await getSession();
  if (!session) return null;
  return {
    email: session.email,
    displayName: session.displayName,
    provider: session.provider,
  };
}

export async function requireSession(): Promise<MailSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
