import { looksLikeQuestion } from "@/lib/jev/ask/question";
import type { MessageKeyAction } from "@/lib/keyboard";
import type { MailFolder } from "@/lib/mail/types";

/*
 * What the ⌘K palette lists, in order, for the typed text. Pure data: the
 * component maps each action to its effect, so ordering and filtering are
 * tested here without a DOM. The palette turns cmdk's own filter off, so
 * the Ask and Search rows can never be filtered away.
 */

export type PaletteAction =
  | { kind: "askOpen" }
  | { kind: "ask"; question: string }
  | { kind: "search"; query: string }
  | { kind: "compose" }
  | { kind: "theme"; to: "light" | "dark" }
  | { kind: "go"; href: string }
  | { kind: "message"; action: MessageKeyAction };

export type PaletteIcon =
  | "ask"
  | "search"
  | "compose"
  | "theme-light"
  | "theme-dark"
  | "settings"
  | "page-overview"
  | "page-integrations"
  | "folder"
  | NonNullable<MailFolder["specialUse"]>
  | MessageKeyAction;

export type PaletteCommand = {
  id: string;
  label: string;
  /** Shortcut hint; "mod" becomes ⌘ or Ctrl. */
  keys?: string[];
  keywords?: string;
  icon: PaletteIcon;
  action: PaletteAction;
};

export type PaletteGroup = { heading: string; items: PaletteCommand[] };

/** Registered by the open reader; null when no message is open. */
export type PaletteMessage = { canArchive: boolean; inTrash: boolean; flagged: boolean; canReplyAll: boolean };

export type PaletteContext = {
  query: string;
  theme: "light" | "dark";
  folders: Pick<MailFolder, "path" | "name" | "specialUse">[];
  message: PaletteMessage | null;
  sections: { id: string; label: string; blurb: string }[];
  /** Sections whose settings rows match the text (`searchSettings`). */
  settingsHits: string[];
  /** Who answers Ask: Kage when there's no Jev key (`askName`). */
  askName?: "Jev" | "Kage";
};

const ROLES: [NonNullable<MailFolder["specialUse"]>, string][] = [
  ["\\Inbox", "Inbox"],
  ["\\Sent", "Sent"],
  ["\\Drafts", "Drafts"],
  ["\\Archive", "Archive"],
  ["\\Junk", "Junk"],
  ["\\Trash", "Trash"],
];

function folderCommands(folders: PaletteContext["folders"]): PaletteCommand[] {
  const rank = (f: PaletteContext["folders"][number]) => {
    const i = ROLES.findIndex(([role]) => role === f.specialUse);
    return i === -1 ? ROLES.length : i;
  };
  return [...folders]
    .sort((a, b) => rank(a) - rank(b))
    .map((f) => {
      const role = ROLES.find(([r]) => r === f.specialUse);
      const label = role?.[1] ?? f.name;
      return {
        id: `folder:${f.path}`,
        label,
        keywords: `folder go ${f.path}`,
        icon: f.specialUse ?? "folder",
        action: { kind: "go", href: f.specialUse === "\\Inbox" ? "/mail" : `/mail?folder=${encodeURIComponent(f.path)}` },
      };
    });
}

function messageCommands(m: PaletteMessage): PaletteCommand[] {
  const run = (action: MessageKeyAction) => ({ kind: "message", action }) as const;
  const archive: PaletteCommand[] = m.canArchive
    ? [{ id: "msg:archive", label: "Archive", keys: ["E"], icon: "archive", action: run("archive") }]
    : [];
  const replyAll: PaletteCommand[] = m.canReplyAll
    ? [{ id: "msg:replyAll", label: "Reply all", keys: ["A"], icon: "replyAll", action: run("replyAll") }]
    : [];
  return [
    ...archive,
    {
      id: "msg:trash",
      label: m.inTrash ? "Delete forever" : "Move to Trash",
      keys: ["#"],
      keywords: "delete remove",
      icon: "trash",
      action: run("trash"),
    },
    {
      id: "msg:star",
      label: m.flagged ? "Remove star" : "Star",
      keys: ["S"],
      keywords: "flag",
      icon: "star",
      action: run("star"),
    },
    { id: "msg:unread", label: "Mark unread", keys: ["Shift", "U"], icon: "unread", action: run("unread") },
    { id: "msg:reply", label: "Reply", keys: ["R"], icon: "reply", action: run("reply") },
    ...replyAll,
    { id: "msg:forward", label: "Forward", keys: ["Shift", "F"], icon: "forward", action: run("forward") },
  ];
}

function matches(command: PaletteCommand, terms: string[]): boolean {
  const hay = `${command.label} ${command.keywords ?? ""}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export function buildCommands(ctx: PaletteContext): PaletteGroup[] {
  const query = ctx.query.trim();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = new Set(ctx.settingsHits);

  const fixed: PaletteGroup[] = [
    {
      heading: "Actions",
      items: [
        { id: "compose", label: "Compose", keys: ["C"], keywords: "new message write email", icon: "compose", action: { kind: "compose" } },
        ctx.theme === "dark"
          ? { id: "theme", label: "Switch to Ember", keywords: "theme light mode appearance", icon: "theme-light", action: { kind: "theme", to: "light" } }
          : { id: "theme", label: "Switch to Nebula", keywords: "theme dark mode appearance", icon: "theme-dark", action: { kind: "theme", to: "dark" } },
        { id: "settings", label: "Open settings", keys: ["mod", ","], keywords: "preferences options", icon: "settings", action: { kind: "go", href: "/settings" } },
      ],
    },
    { heading: "This message", items: ctx.message ? messageCommands(ctx.message) : [] },
    {
      heading: "Go to",
      items: [
        { id: "page:overview", label: "Overview", keywords: "home dashboard page", icon: "page-overview", action: { kind: "go", href: "/overview" } },
        ...folderCommands(ctx.folders),
        { id: "page:integrations", label: "Integrations", keywords: "slack discord webhook export page", icon: "page-integrations", action: { kind: "go", href: "/integrations" } },
      ],
    },
    {
      heading: "Settings",
      items: ctx.sections.map((s) => ({
        id: `section:${s.id}`,
        label: `${s.label} settings`,
        keywords: s.blurb,
        icon: "settings",
        action: { kind: "go", href: `/settings?s=${s.id}` },
      })),
    },
  ];

  const name = ctx.askName ?? "Jev";
  if (!terms.length) {
    const ask: PaletteGroup = {
      heading: name,
      items: [{ id: "ask-open", label: `Ask ${name}`, keywords: "question", icon: "ask", action: { kind: "askOpen" } }],
    };
    return [ask, ...fixed].filter((g) => g.items.length);
  }

  const filtered = fixed
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (c) => matches(c, terms) || (c.id.startsWith("section:") && hits.has(c.id.slice("section:".length))),
      ),
    }))
    .filter((g) => g.items.length);
  const ask: PaletteGroup = {
    heading: name,
    items: [{ id: "ask", label: `Ask ${name}: "${query}"`, icon: "ask", action: { kind: "ask", question: query } }],
  };
  const search: PaletteGroup = {
    heading: "Search",
    items: [{ id: "search", label: `Search mail for "${query}"`, keys: ["/"], icon: "search", action: { kind: "search", query } }],
  };
  return looksLikeQuestion(query) ? [ask, search, ...filtered] : [...filtered, search, ask];
}
