import { afterEach, describe, expect, test } from "bun:test";
import { useComposeStore } from "@/lib/store/compose";
import { resetPrefs, setPref } from "@/lib/prefs/store";

afterEach(() => {
  resetPrefs();
  useComposeStore.getState().closeCompose();
});

const text = () => useComposeStore.getState().draft.text;

describe("openCompose and the signature", () => {
  test("no signature set: nothing added", () => {
    useComposeStore.getState().openCompose("new");
    expect(text()).toBe("");
  });

  test("new mail and replies start with it", () => {
    setPref("mail.signature", "Sam");
    useComposeStore.getState().openCompose("new");
    expect(text()).toBe("\n\n-- \nSam");
    useComposeStore.getState().openCompose("reply", { to: "a@x", subject: "Re: Hi", quote: { kind: "reply", header: "On Mon, A wrote:", body: "Hi" } });
    expect(text()).toBe("\n\n-- \nSam");
  });

  test("a reopened draft is left exactly as it was, even with the signature removed", () => {
    setPref("mail.signature", "Sam");
    useComposeStore.getState().openCompose("new", { text: "Edited, no sign-off" }, { draftUid: "7", signature: false });
    expect(text()).toBe("Edited, no sign-off");
  });

  test("a draft that already has it doesn't get a second one", () => {
    setPref("mail.signature", "Sam");
    useComposeStore.getState().openCompose("new", { text: "Hi\n\n-- \nSam" });
    expect(text()).toBe("Hi\n\n-- \nSam");
  });
});
