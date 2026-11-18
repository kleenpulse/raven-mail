/*
 * How big one send or save may be. Imported by next.config.ts (which picks a
 * row and inlines its budget as SEND_BUDGET_BYTES), so this file imports nothing.
 *
 * `body` is the Server Action request limit. `budget` is what compose allows
 * for files (as base64), HTML and text together, kept a little under `body`.
 */
export const SEND_LIMITS = {
  // Vercel rejects any function request over 4.5 MB before the action runs.
  vercel: { body: "4.5mb", budget: 4_200_000 },
  // 18 MiB of files is 24 MiB of base64 and about 24.6 MiB on the wire: under the usual 25 MB SMTP cap.
  selfHosted: { body: "26mb", budget: 25_690_112 },
} as const;

/** Most files one message can carry (the send action's schema enforces it too). */
export const MAX_FILES = 20;
