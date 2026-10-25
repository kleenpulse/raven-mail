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

describe("draftRow", () => {
  test("follows a save to the new copy and survives losing the server copy", () => {
    const store = useComposeStore.getState();
    store.openCompose("new", {}, { draftUid: "7", signature: false });
    expect(useComposeStore.getState().draftRow).toBe("7");

    store.setDraftUid("9");
    expect(useComposeStore.getState().draftRow).toBe("9");

    // Files that couldn't load: the next save adds a copy, but the open row is still this one.
    store.setDraftUid(undefined);
    expect(useComposeStore.getState()).toMatchObject({ draftUid: undefined, draftRow: "9" });

    store.closeCompose();
    expect(useComposeStore.getState().draftRow).toBeUndefined();
  });

  test("new mail isn't tied to any row", () => {
    useComposeStore.getState().openCompose("new");
    expect(useComposeStore.getState().draftRow).toBeUndefined();
  });
});
