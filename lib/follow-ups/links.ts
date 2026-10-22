import { mailLink } from "@/lib/jev/ask/format";
import type { FollowUpDTO } from "./types";

/**
 * Where "Open thread" goes: the sent message, whose reader shows the
 * conversation. Without a uid (the Sent copy wasn't found) it searches Sent
 * for the subject instead of guessing.
 */
export function followUpHref(f: Pick<FollowUpDTO, "folder" | "uid" | "messageId" | "subject">): string {
	if (f.uid) return mailLink(f);
	return `/mail?${new URLSearchParams({ folder: f.folder, q: f.subject })}`;
}
