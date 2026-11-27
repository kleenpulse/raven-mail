export function parseHeaderBlock(raw: Uint8Array | string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw) return out;
  const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
  const unfolded = text.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    const prev = out.get(key);
    out.set(key, prev ? `${prev}, ${value}` : value);
  }
  return out;
}

const NAMED_ZONES: Record<string, number> = {
  UT: 0,
  UTC: 0,
  GMT: 0,
  Z: 0,
  EST: -300,
  EDT: -240,
  CST: -360,
  CDT: -300,
  MST: -420,
  MDT: -360,
  PST: -480,
  PDT: -420,
};

export function parseDateHeader(value: string | undefined): { epoch: number; offsetMin: number } | null {
  if (!value) return null;
  const epoch = Date.parse(value.replace(/\s*\([^)]*\)\s*$/, ""));
  if (Number.isNaN(epoch)) return null;
  const numeric = value.match(/([+-])(\d{2}):?(\d{2})(?:\s*\([^)]*\))?\s*$/);
  if (numeric) {
    const sign = numeric[1] === "-" ? -1 : 1;
    return { epoch, offsetMin: sign * (Number(numeric[2]) * 60 + Number(numeric[3])) };
  }
  const named = value.match(/\b([A-Z]{1,3})\s*$/);
  if (named && named[1]! in NAMED_ZONES) return { epoch, offsetMin: NAMED_ZONES[named[1]!]! };
  return { epoch, offsetMin: 0 };
}

const MAX_TARGET = 2048;

export function parseListUnsubscribe(value: string | undefined): { https?: string; mailto?: string } | undefined {
  if (!value) return undefined;
  const targets = [...value.matchAll(/<([^>]+)>/g)]
    .map((m) => m[1]!.trim())
    .filter((t) => t.length <= MAX_TARGET && URL.canParse(t));
  const https = targets.find((t) => /^https:\/\//i.test(t));
  const mailto = targets.find((t) => /^mailto:/i.test(t));
  return https || mailto ? { https, mailto } : undefined;
}

export type UnsubscribeOptions = { https?: string; mailto?: string; oneClick: boolean };

export function unsubscribeOptions(headers: Record<string, string | undefined>): UnsubscribeOptions | undefined {
  const targets = parseListUnsubscribe(headers["list-unsubscribe"]);
  if (!targets) return undefined;
  const post = headers["list-unsubscribe-post"]?.trim() ?? "";
  return { ...targets, oneClick: Boolean(targets.https) && /^List-Unsubscribe=One-Click$/i.test(post) };
}

export type MailtoFields = { to: string; cc?: string; bcc?: string; subject?: string; body?: string };

export function mailtoFields(href: string): MailtoFields | undefined {
  const match = /^mailto:([^?]*)(?:\?([\s\S]*))?$/i.exec(href.trim());
  if (!match) return undefined;
  try {
    const to = [decodeURIComponent(match[1]!)];
    const rest: Omit<MailtoFields, "to"> = {};
    for (const pair of (match[2] ?? "").split("&")) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const key = decodeURIComponent(pair.slice(0, eq)).toLowerCase();
      const value = decodeURIComponent(pair.slice(eq + 1));
      if (!value) continue;
      if (key === "to") to.push(value);
      else if (key === "cc" || key === "bcc" || key === "subject") rest[key] ??= value;
      else if (key === "body") rest.body ??= value.replace(/\r\n?/g, "\n");
    }
    return { to: to.filter(Boolean).join(", "), ...rest };
  } catch {
    return undefined;
  }
}

export function mailtoDraft(href: string): { to: string; cc?: string; bcc?: string; subject: string; text: string } | undefined {
  const fields = mailtoFields(href);
  if (!fields) return undefined;
  const { body, subject, ...recipients } = fields;
  return { ...recipients, subject: subject ?? "", text: body ?? "" };
}

export function isAbsoluteMailLink(href: string): boolean {
  return /^\s*(?:https?|mailto|tel|cid):/i.test(href);
}

export function parseMailto(href: string): { to: string; subject: string; body: string } | undefined {
  const fields = mailtoFields(href);
  if (!fields?.to.includes("@")) return undefined;
  return { to: fields.to, subject: fields.subject || "unsubscribe", body: fields.body || "unsubscribe" };
}

export function listHeaders(lines: readonly { key: string; line: string }[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, line } of lines ?? []) {
    const name = key.toLowerCase();
    if (!name.startsWith("list-")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const value = line.slice(idx + 1).replace(/\r?\n[ \t]+/g, " ").trim();
    out[name] = out[name] ? `${out[name]}, ${value}` : value;
  }
  return out;
}

export function parseReferences(value: string | undefined): string[] {
  if (!value) return [];
  return value.match(/<[^<>\s]+>/g) ?? [];
}
