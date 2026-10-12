import { describe, expect, test } from "bun:test";
import { heuristicTriage } from "@/lib/triage/heuristic";
import type { TriageCategory } from "@/lib/mail/types";

describe("heuristicTriage categories", () => {
  test.each<[string, { subject: string; from: string }, TriageCategory]>([
    ["work-tool mentions are updates, not social", { subject: "Maya mentioned you in ENG-142", from: "notifications@linear.app" }, "updates"],
    ["calendar invites are updates", { subject: "Invitation: Standup @ Fri Sep 25", from: "calendar-notification@google.com" }, "updates"],
    ["social networks are social", { subject: "Priya wants to connect", from: "invitations@linkedin.com" }, "social"],
    ["a person asking something is primary", { subject: "Lunch Thursday?", from: "maya@northwind.example" }, "primary"],
    [
      "a branded shipping notice is a receipt",
      { subject: "Your Temu order has been transferred to UPS for delivery (#PO-147-21220400026230)", from: "temu@orders.temu.com" },
      "receipts",
    ],
  ])("%s", (_, input, category) => {
    expect(heuristicTriage(input).category).toBe(category);
  });
});

describe("heuristicTriage needsReply", () => {
  test("automated mail never needs a reply, however many request words it has", () => {
    const r = heuristicTriage({
      subject: "Your Temu order has been transferred to UPS for delivery",
      snippet: "Please review your order and let me know… confirm your address? Leave feedback.",
      from: "temu@orders.temu.com",
    });
    expect(r.needsReply).toBe(false);
  });

  test("a person asking something needs a reply", () => {
    expect(heuristicTriage({ subject: "Lunch Thursday?", from: "maya@northwind.example" }).needsReply).toBe(true);
  });
});
