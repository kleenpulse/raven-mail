import { describe, expect, test } from "bun:test";
import { looksLikeQuestion } from "@/lib/jev/ask/question";

describe("looksLikeQuestion", () => {
  test.each([
    "who is waiting on me",
    "what did Maya send",
    "is the contract signed",
    "show unread from this week",
    "invoices from last month",
    "anything urgent today",
    "venue?",
    "  How fast do I reply  ",
  ])("%p reads like a question", (text) => {
    expect(looksLikeQuestion(text)).toBe(true);
  });

  test.each(["", "   ", "arch", "settings", "trash", "show", "find", "nebula", "go to inbox", "dark mode", "q3 roadmap"])(
    "%p reads like a command",
    (text) => {
      expect(looksLikeQuestion(text)).toBe(false);
    },
  );
});
