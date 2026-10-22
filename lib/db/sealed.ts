import "server-only";
import { createHash } from "node:crypto";
import { deriveKey } from "@/lib/server/secret";
import { hmac, sealWith, unsealWith } from "@/lib/integrations/seal";

/*
 * Sealing for rules, blocked senders and reminders: one derived key per
 * feature, each value bound to `account_key|id`. Rotating the app secret
 * makes these unreadable, as it does integrations.
 */

export type SealPurpose = "rules" | "rule-events" | "blocks" | "follow-ups";

const KEYS: Record<SealPurpose, string> = {
  rules: "raven:rules:v1",
  "rule-events": "raven:rule-events:v1",
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

/**
 * Which message a rule judged, under which wording. The criteria hash means an
 * edited rule judges again while its old log stays. Without a Message-ID the
 * message is named by folder, UIDVALIDITY and uid instead.
 */
export function ruleMessageFingerprint(
  accountKey: string,
  rule: { id: string; criteria: string },
  message: { messageId?: string; folder: string; uidValidity: string; uid: string },
): string {
  const criteria = createHash("sha256").update(rule.criteria).digest("hex");
  const which = message.messageId
    ? `mid:${message.messageId}`
    : `uid:${message.folder}|${message.uidValidity}|${message.uid}`;
  return hmac(deriveKey("raven:rule-msg:v1"), `${accountKey}|${rule.id}|${criteria}|${which}`);
}
