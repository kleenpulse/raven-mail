import { z } from "zod";
import { json, parseWith, requireApiSession, route } from "@/lib/server/guard";
import { listMessages } from "@/lib/mail/imap";
import { devListMessages, isDevSession } from "@/lib/mail/dev-store";
import { folderParam, mailError, uidParam } from "@/lib/api/mail-read";

export const maxDuration = 60;

const querySchema = z.object({
  folder: folderParam,
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  before: uidParam.optional(),
});

export const GET = route(async (request) => {
  const session = await requireApiSession();
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const { folder, q, limit, before } = parseWith(querySchema, params);
  const opts = { limit: limit ?? 50, before: before ? Number(before) : undefined, search: q || undefined };
  if (isDevSession(session)) return json({ ok: true, data: devListMessages(folder, opts) });
  const data = await listMessages(session, folder, opts).catch(mailError);
  return json({ ok: true, data });
});
