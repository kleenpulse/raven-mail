import "server-only";
import { deriveKey } from "@/lib/server/secret";
import { hmac, sealWith, unsealWith } from "@/lib/integrations/seal";

/*
 * Sealing for rules, blocked senders and reminders: one derived key per
 * feature, each value bound to `account_key|id`. Rotating the app secret
 * makes these unreadable, as it does integrations.
 */

export type SealPurpose = "rules" | "blocks" | "follow-ups";

const KEYS: Record<SealPurpose, string> = {
  rules: "raven:rules:v1",
  blocks: "raven:blocks:v1",
  "follow-ups": "raven:follow-ups:v1",
};

export function sealRow(purpose: SealPurpose, value: unknown, accountKey: string, id: string): string {
  return sealWith(deriveKey(KEYS[purpose]), value, `${accountKey}|${id}`);
}

/** Throws when the row was moved, tampered with, or sealed under another secret. */
export function openRow<T>(purpose: SealPurpose, token: string, accountKey: string, id: string): T {
  return unsealWith<T>(deriveKey(KEYS[purpose]), token, `${accountKey}|${id}`);
}

/** Dedupe key for a blocked address or domain; case and spaces don't matter. */
export function blockFingerprint(accountKey: string, kind: string, value: string): string {
  return hmac(deriveKey("raven:block:v1"), `${accountKey}|${kind}|${value.trim().toLowerCase()}`);
}
