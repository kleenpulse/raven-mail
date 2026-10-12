import { z } from "zod";
import { HttpError, readJson, requireApiSession, route } from "@/lib/server/guard";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { sessionKey } from "@/lib/server/session-key";
import { isValidTimeZone } from "@/lib/insights/bins";
import { folderParam, uidParam } from "@/lib/api/mail-read";
import { runAsk } from "@/lib/jev/ask/pipeline";
import { INTENTS, type AskEvent } from "@/lib/jev/ask/types";

export const maxDuration = 60;

const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

const askSchema = z.object({
  question: z.string().trim().min(1, "Ask something.").max(500, "Keep it under 500 characters."),
  forcedIntent: z.enum(INTENTS).optional(),
  filter: z.string().trim().max(200).optional(),
  tz: z.string().max(64).default("UTC"),
  context: z.object({ folder: folderParam.optional(), uid: uidParam.optional() }).optional(),
});

export const POST = route(async (request) => {
  const session = await requireApiSession();
  const body = await readJson(request, askSchema);
  if (!isValidTimeZone(body.tz)) throw new HttpError(400, "Unknown time zone.", "bad_request");
  const allowed = limiter.take(sessionKey(session));
  if (!allowed.ok) {
    throw new HttpError(429, `Easy — try again in ${Math.ceil(allowed.retryAfterMs / 1000)}s.`, "rate_limited");
  }

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, event: AskEvent) =>
    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runAsk(session, body, { tz: body.tz, signal: request.signal })) {
          if (request.signal.aborted) break;
          send(controller, event);
        }
      } catch (err) {
        console.error("[jev/ask]", err);
        if (!request.signal.aborted) {
          send(controller, { type: "error", message: "I couldn’t read your mailbox just now. Try again in a moment." });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Accel-Buffering": "no",
    },
  });
});
