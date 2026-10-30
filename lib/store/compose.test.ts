import { afterEach, describe, expect, test } from "bun:test";
import { hasUnsavedChanges, useComposeStore } from "@/lib/store/compose";
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

describe("unsaved changes", () => {
  const store = () => useComposeStore.getState();
  const unsaved = () => hasUnsavedChanges(store());

  test("loading a draft isn't a change: the editor's first pass and its files keep it saved", () => {
    store().openCompose("new", { subject: "Plan", html: "<p>Hi</p>" }, { draftUid: "7", signature: false });
    store().setDraft({ html: "<p>Hi</p>", text: "Hi" }, { edit: false });
    store().addAttachments([{ filename: "a.txt", contentType: "text/plain", contentBase64: "aGk=", size: 2 }], { edit: false });
    expect(unsaved()).toBe(false);

    store().setDraft({ subject: "Plan B" });
    expect(unsaved()).toBe(true);
  });

  test("an empty message, or only the signature, has nothing to lose", () => {
    setPref("mail.signature", "Sam");
    store().openCompose("new");
    store().setDraft({ text: "\n\n-- \nSam" });
    expect(unsaved()).toBe(false);
    store().setDraft({ subject: "  " });
    expect(unsaved()).toBe(false);
  });

  test("a save covers the changes made before it started, not the ones typed during it", () => {
    store().openCompose("new");
    store().setDraft({ subject: "Hi" });
    const before = store().edits;
    store().setDraft({ subject: "Hi there" });
    store().markSaved(before);
    expect(unsaved()).toBe(true);
    store().markSaved(store().edits);
    expect(unsaved()).toBe(false);
  });

  test("opening something else is held back, and nothing runs until the user answers", () => {
    store().openCompose("new");
    store().setDraft({ subject: "Mine" });
    store().minimize();
    let opened = 0;

    expect(store().openCompose("new", { subject: "Other" }, { draftUid: "8", onOpen: () => opened++ })).toBe(false);
    expect(store().draft.subject).toBe("Mine");
    expect(store().pendingOpen).toMatchObject({ mode: "new", draft: { subject: "Other" } });
    expect(opened).toBe(0);

    store().answerPending(false);
    expect(store()).toMatchObject({ pendingOpen: null, minimized: false });
    expect(store().draft.subject).toBe("Mine");
    expect(opened).toBe(0);
  });

  test("agreeing opens the held message and runs what was waiting on it", () => {
    store().openCompose("new");
    store().setDraft({ subject: "Mine" });
    let opened = 0;
    store().openCompose("new", { subject: "Other" }, { draftUid: "8", signature: false, onOpen: () => opened++ });

    store().answerPending(true);
    expect(store()).toMatchObject({ pendingOpen: null, draftRow: "8", edits: 0 });
    expect(store().draft.subject).toBe("Other");
    expect(opened).toBe(1);
  });

  test("a message put back by Undo starts unsaved, with its files", () => {
    const file = { filename: "a.txt", contentType: "text/plain", contentBase64: "aGk=", size: 2 };
    store().openCompose("new", { subject: "Back" }, { signature: false, attachments: [file], unsaved: true });
    expect(store().attachments).toEqual([file]);
    expect(unsaved()).toBe(true);
  });

  test("nothing unsaved: opening goes straight through", () => {
    store().openCompose("new", { subject: "A" });
    expect(store().openCompose("new", { subject: "B" })).toBe(true);
    expect(store().draft.subject).toBe("B");
  });
});
