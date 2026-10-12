import type { MailFolder } from "@/lib/mail/types";

const SPECIAL_PATTERNS: { role: NonNullable<MailFolder["specialUse"]>; re: RegExp }[] = [
  { role: "\\Inbox", re: /^(inbox|inbound|received)$/i },
  { role: "\\Sent", re: /(sent|sent items|sent mail|outbox)$/i },
  { role: "\\Drafts", re: /(drafts?|unsent)$/i },
  { role: "\\Trash", re: /(trash|deleted|deleted items|bin|corbeille)$/i },
  { role: "\\Junk", re: /(junk|spam|junk e-mail|junk-email|junk email)$/i },
  { role: "\\Archive", re: /(archive|all mail|archives)$/i },
];

function basename(path: string, delimiter: string): string {
  const parts = path.split(delimiter);
  return parts[parts.length - 1] ?? path;
}

export function labelSpecialUse(
  path: string,
  delimiter: string,
  declared?: string,
): MailFolder["specialUse"] {
  if (declared && (declared as string) in Object.fromEntries(SPECIAL_PATTERNS.map((p) => [p.role, true]))) {
    return declared as MailFolder["specialUse"];
  }
  const name = basename(path, delimiter);
  const hit = SPECIAL_PATTERNS.find((p) => p.re.test(name));
  return hit?.role;
}

export function shortFolderName(path: string, delimiter: string): string {
  return basename(path, delimiter);
}

export function resolveSpecialFolder(
  folders: MailFolder[],
  role: NonNullable<MailFolder["specialUse"]>,
): string | null {
  const byFlag = folders.find((f) => f.specialUse === role);
  if (byFlag) return byFlag.path;
  const byName = folders.find((f) => {
    const hit = SPECIAL_PATTERNS.find((p) => p.role === role);
    return hit ? hit.re.test(shortFolderName(f.path, f.delimiter)) : false;
  });
  return byName?.path ?? null;
}

/** Special-use role for the open folder (flag on the folder, else name match). */
export function folderSpecialUse(
  folders: MailFolder[] | undefined,
  path: string,
): MailFolder["specialUse"] {
  const entry = folders?.find((f) => f.path === path);
  if (entry) {
    return entry.specialUse ?? labelSpecialUse(entry.path, entry.delimiter);
  }
  return labelSpecialUse(path, "/", undefined);
}
