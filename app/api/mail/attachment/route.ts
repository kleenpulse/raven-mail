import { z } from "zod";
import { parseWith, requireApiSession, route } from "@/lib/server/guard";
import { downloadAttachment } from "@/lib/mail/imap";
import { devGetAttachment, isDevSession } from "@/lib/mail/dev-store";
import { folderParam, mailError, uidParam } from "@/lib/api/mail-read";
import { attachmentHeaders, SECTION_RE } from "@/lib/mail/attachment";

// Big files stream for a while; the connection is held until the last byte.
export const maxDuration = 300;

const querySchema = z.object({
  folder: folderParam,
  uid: uidParam,
  part: z.string().regex(SECTION_RE, "Invalid attachment part."),
});

/** Always a download: never rendered inline, whatever the sender labelled it. */
export const GET = route(async (request) => {
  const session = await requireApiSession();
  const { folder, uid, part } = parseWith(querySchema, Object.fromEntries(new URL(request.url).searchParams));
  if (isDevSession(session)) {
    try {
      const { meta, bytes } = devGetAttachment(folder, uid, part);
      return new Response(new Uint8Array(bytes), { headers: attachmentHeaders({ ...meta, size: bytes.byteLength }) });
    } catch (err) {
      mailError(err);
    }
  }
  const file = await downloadAttachment(session, folder, uid, part, request.signal).catch(mailError);
  return new Response(file.body, { headers: attachmentHeaders(file) });
});
