import { z } from "zod";
import { json, readJson, requireApiSession, route, HttpError } from "@/lib/server/guard";
import { deleteMessagesAction, moveMessagesAction } from "@/lib/actions/mail";

const bodySchema = z.object({
  kind: z.enum(["archive", "trash", "inbox", "deleteForever"]),
  folder: z.string(),
  uids: z.array(z.string()),
  destination: z.string().optional(),
});

/**
 * Commits a deferred archive / trash / move from `fetch(…, { keepalive })`
 * when the page is hidden: a Server Action's request dies with the page.
 * Same-origin is enforced by `route`; the actions re-validate every field.
 */
export const POST = route(async (request) => {
  await requireApiSession();
  const { kind, folder, uids, destination } = await readJson(request, bodySchema);
  const res =
    kind === "archive" || kind === "inbox"
      ? await moveMessagesAction({ folder, uids, destination: destination ?? "" })
      : await deleteMessagesAction({ folder, uids });
  if (!res.ok) throw new HttpError(400, res.error, "bad_request");
  return json({ ok: true, data: null });
});
