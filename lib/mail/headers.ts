/** Pure RFC 5322 header helpers (raw header block from IMAP `headers: [...]` fetches). */

export function parseHeaderBlock(raw: Uint8Array | string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw) return out;
  const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
  // Unfold continuation lines (CRLF/LF followed by whitespace).
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

/** Date: header → epoch + the writer's UTC offset in minutes (east positive). */
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

/** List-Unsubscribe: `<https://…>, <mailto:…>` → first https + first mailto target. */
export function parseListUnsubscribe(value: string | undefined): { https?: string; mailto?: string } | undefined {
  if (!value) return undefined;
  const targets = [...value.matchAll(/<([^>]+)>/g)].map((m) => m[1]!.trim());
  const https = targets.find((t) => /^https:\/\//i.test(t));
  const mailto = targets.find((t) => /^mailto:/i.test(t));
  return https || mailto ? { https, mailto } : undefined;
}

export function parseReferences(value: string | undefined): string[] {
  if (!value) return [];
  return value.match(/<[^<>\s]+>/g) ?? [];
}
