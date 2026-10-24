"use server";

import { z } from "zod";
import { getSession, setSession } from "@/lib/session";
import { jevStatus, verifyJevKey, type JevStatus } from "@/lib/jev/client";
import { classifyJevError } from "@/lib/integrations/diagnostics/jev";
import type { ActionResult } from "@/lib/mail/types";

const keySchema = z
  .string()
  .trim()
  .min(16, "That key looks too short. Copy the whole key from console.typesafe.ai.")
  .max(256, "That key looks too long. Copy just the key.")
  .regex(/^[\x21-\x7e]+$/, "A key has no spaces. Copy it again.");

const NO_SESSION = "Your session ended. Sign in again, then save the key.";

/**
 * Saves the user's own TypeSafe key into their encrypted session cookie, after
 * one free models.list call proves TypeSafe accepts it.
 */
export async function saveJevKeyAction(raw: string): Promise<ActionResult<JevStatus>> {
  const session = await getSession();
  if (!session) return { ok: false, error: NO_SESSION };

  const parsed = keySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const key = parsed.data;

  try {
    await verifyJevKey(key);
  } catch (err) {
    const problem = classifyJevError(err);
    if (problem.code === "jev_key_rejected") {
      return { ok: false, error: "TypeSafe didn't accept that key. Check you copied all of it, or create a new one at console.typesafe.ai." };
    }
    return { ok: false, error: `${problem.message} ${problem.hint}` };
  }

  const next = { ...session, jevKey: key };
  await setSession(next);
  return { ok: true, data: await jevStatus(next) };
}

export async function removeJevKeyAction(): Promise<ActionResult<JevStatus>> {
  const session = await getSession();
  if (!session) return { ok: false, error: NO_SESSION };
  const rest = { ...session };
  delete rest.jevKey;
  await setSession(rest);
  return { ok: true, data: await jevStatus(null) };
}
