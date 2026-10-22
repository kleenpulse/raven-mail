import { describe, expect, test } from "bun:test";
import { buildCommands, type PaletteContext } from "@/lib/palette/commands";

const ctx = (over: Partial<PaletteContext> = {}): PaletteContext => ({
  query: "",
  theme: "light",
  folders: [
    { path: "Projects", name: "Projects" },
    { path: "[Gmail]/Trash", name: "Trash", specialUse: "\\Trash" },
    { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
    { path: "[Gmail]/Sent Mail", name: "Sent Mail", specialUse: "\\Sent" },
  ],
  message: null,
  sections: [
    { id: "appearance", label: "Appearance", blurb: "How Raven looks." },
    { id: "mail", label: "Mail", blurb: "How you read, send and delete mail." },
  ],
  settingsHits: [],
  ...over,
});

const ids = (groups: ReturnType<typeof buildCommands>) => groups.flatMap((g) => g.items.map((c) => c.id));
const headings = (groups: ReturnType<typeof buildCommands>) => groups.map((g) => g.heading);

describe("buildCommands", () => {
  test("no text: Ask Jev opens the tray from the top row, then everything", () => {
    const groups = buildCommands(ctx());
    expect(groups[0]!.items[0]!.action).toEqual({ kind: "askOpen" });
    expect(headings(groups)).toEqual(["Jev", "Actions", "Go to", "Settings"]);
  });

  test("folders: special ones first in sidebar order, Inbox links to /mail, others carry the path", () => {
    const go = buildCommands(ctx()).find((g) => g.heading === "Go to")!.items;
    expect(go.map((c) => c.label)).toEqual(["Overview", "Inbox", "Sent", "Trash", "Projects", "Integrations"]);
    expect(go[1]!.action).toEqual({ kind: "go", href: "/mail" });
    expect(go[2]!.action).toEqual({ kind: "go", href: "/mail?folder=%5BGmail%5D%2FSent%20Mail" });
  });

  test("a question puts Ask Jev on top, then Search", () => {
    const groups = buildCommands(ctx({ query: "who is waiting on me" }));
    expect(groups[0]!.items[0]!).toMatchObject({ label: 'Ask Jev: "who is waiting on me"', action: { kind: "ask", question: "who is waiting on me" } });
    expect(groups[1]!.items[0]!.action).toEqual({ kind: "search", query: "who is waiting on me" });
  });

  test("a command word: matches first, then Search, then Ask Jev last", () => {
    const groups = buildCommands(ctx({ query: "tra" }));
    expect(ids(groups)).toEqual(["folder:[Gmail]/Trash", "search", "ask"]);
  });

  test("Ask and Search stay whatever is typed, even when nothing else matches", () => {
    expect(ids(buildCommands(ctx({ query: "zzzz" })))).toEqual(["search", "ask"]);
  });

  test("every word must match; keywords count", () => {
    expect(ids(buildCommands(ctx({ query: "dark mode" })))).toContain("theme");
    expect(ids(buildCommands(ctx({ query: "dark nope" })))).not.toContain("theme");
  });

  test("the theme row offers the other look", () => {
    expect(buildCommands(ctx({ theme: "dark" }))[1]!.items[1]).toMatchObject({ label: "Switch to Ember", action: { to: "light" } });
    expect(buildCommands(ctx())[1]!.items[1]).toMatchObject({ label: "Switch to Nebula", action: { to: "dark" } });
  });

  test("a settings row match brings up its section", () => {
    const groups = buildCommands(ctx({ query: "threading", settingsHits: ["mail"] }));
    expect(ids(groups)).toContain("section:mail");
    expect(groups.find((g) => g.heading === "Settings")!.items[0]!.action).toEqual({ kind: "go", href: "/settings?s=mail" });
  });

  test("message actions only while a message is open, with their keys", () => {
    expect(headings(buildCommands(ctx()))).not.toContain("This message");
    const m = buildCommands(ctx({ message: { canArchive: true, inTrash: false, flagged: false, canReplyAll: true } }));
    const items = m.find((g) => g.heading === "This message")!.items;
    expect(items.map((c) => [c.label, c.keys?.join("+")])).toEqual([
      ["Archive", "E"],
      ["Move to Trash", "#"],
      ["Star", "S"],
      ["Mark unread", "Shift+U"],
      ["Reply", "R"],
      ["Reply all", "A"],
      ["Forward", "Shift+F"],
    ]);
  });

  test("in Trash, starred, no Archive, one recipient", () => {
    const m = buildCommands(ctx({ message: { canArchive: false, inTrash: true, flagged: true, canReplyAll: false } }));
    const labels = m.find((g) => g.heading === "This message")!.items.map((c) => c.label);
    expect(labels).toEqual(["Delete forever", "Remove star", "Mark unread", "Reply", "Forward"]);
  });
});
