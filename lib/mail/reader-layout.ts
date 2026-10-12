/**
 * Mail split layout: the list's width and whether the reader has taken the
 * whole pane. Stored in a cookie, not localStorage, so the server renders the
 * saved layout and a reload never flashes the default width first.
 */
export type MailLayout = {
  /** Px width of the message list; null keeps the responsive default. */
  listWidth: number | null;
  /** The reader spans the pane and the list is hidden (md+ only). */
  wide: boolean;
};

export const MAIL_LAYOUT_COOKIE = "em-mail-layout";
export const LIST_MIN = 280;
export const LIST_MAX = 640;
/** The reader never gets squeezed below this by a wide list. */
export const READER_MIN = 360;
/** Dragging this far past LIST_MIN collapses the list into the wide view. */
export const COLLAPSE_SLOP = 96;

export const DEFAULT_MAIL_LAYOUT: MailLayout = { listWidth: null, wide: false };

export function clampListWidth(width: number, container?: number): number {
  const ceiling = container ? Math.min(LIST_MAX, container - READER_MIN) : LIST_MAX;
  return Math.round(Math.max(LIST_MIN, Math.min(Math.max(LIST_MIN, ceiling), width)));
}

/** "<width|empty>:<0|1>" — anything malformed falls back to the default. */
export function parseMailLayout(raw: string | undefined | null): MailLayout {
  if (!raw) return DEFAULT_MAIL_LAYOUT;
  const match = /^(\d{0,4}):([01])$/.exec(decodeURIComponent(raw));
  if (!match) return DEFAULT_MAIL_LAYOUT;
  const width = match[1] ? clampListWidth(Number(match[1])) : null;
  return { listWidth: width, wide: match[2] === "1" };
}

export function serializeMailLayout(layout: MailLayout): string {
  return `${layout.listWidth ?? ""}:${layout.wide ? 1 : 0}`;
}

export function writeMailLayoutCookie(layout: MailLayout): void {
  document.cookie = `${MAIL_LAYOUT_COOKIE}=${serializeMailLayout(layout)}; path=/; max-age=31536000; samesite=lax`;
}
