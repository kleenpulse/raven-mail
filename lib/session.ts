import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { ProviderId, ServerEndpoint } from "@/lib/providers";

export const SESSION_COOKIE = "em_session";

export type MailSession = {
  email: string;
  displayName: string;
  provider: ProviderId;
  password: string;
  imap: ServerEndpoint;
  smtp: ServerEndpoint;
  createdAt: number;
  /** The user's own TypeSafe key (BYOK). Lives and dies with this cookie. */
  jevKey?: string;
  /** Dev-only local mailbox — set by devLoginAction, never honored in production. */
  dev?: boolean;
};

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    // The cookie carries mailbox passwords; a guessable key is not a fallback.
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set (32+ chars) in production.");
    }
    return createHash("sha256").update("dev-only-session-secret-change-me-in-production-32b").digest();
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSession(session: MailSession): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.from(JSON.stringify(session), "utf8");
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptSession(token: string): MailSession | null {
  try {
    const key = getKey();
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    const session = JSON.parse(decrypted.toString("utf8")) as MailSession;
    if (!session.email || !session.imap?.host || !session.smtp?.host) return null;
    return session;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<MailSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return decryptSession(token);
}

export async function setSession(session: MailSession): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, encryptSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
