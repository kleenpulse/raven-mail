import { describe, expect, test } from "bun:test";
import {
  adoptDataImages,
  fileAllowanceMb,
  isInlineType,
  liveAttachments,
  newCid,
  pastedName,
  payloadSize,
  planFiles,
  pruneInline,
  sendProblem,
  usedCids,
} from "@/lib/mail/inline-images";
import { SEND_LIMITS } from "@/lib/mail/send-limits";

const img = (cid: string, extra = "") => `<img src="cid:${cid}" alt="${cid}.png"${extra} style="max-width:100%;height:auto">`;
const file = (name: string, bytes: number, cid?: string) => ({
  filename: name,
  contentType: cid ? "image/png" : "application/pdf",
  contentBase64: "A".repeat(Math.ceil(bytes / 3) * 4),
  size: bytes,
  ...(cid ? { cid } : {}),
});

describe("newCid", () => {
  test("is unique and fits the Content-ID shape the send action accepts", () => {
    const a = newCid();
    expect(a).not.toBe(newCid());
    expect(a).toMatch(/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/);
    expect(a.length).toBeLessThanOrEqual(128);
  });
});

describe("isInlineType", () => {
  test("png, jpeg, gif and webp go in the body; svg, heic and files don't", () => {
    expect(["image/png", "image/JPEG", "image/gif", "image/webp"].every(isInlineType)).toBe(true);
    expect(["image/svg+xml", "image/heic", "image/bmp", "application/pdf", ""].some(isInlineType)).toBe(false);
  });
});

describe("what the body uses", () => {
  test("usedCids reads every cid image and nothing else", () => {
    const html = `<p>Hi ${img("a@raven.mail")}</p><p><a href="cid:fake@x.y">link</a>${img("b@raven.mail", ' width="560"')}</p>`;
    expect([...usedCids(html)]).toEqual(["a@raven.mail", "b@raven.mail"]);
  });

  test("liveAttachments keeps plain files and only the images still in the body", () => {
    const files = [file("a.pdf", 10), file("one.png", 10, "one@raven.mail"), file("gone.png", 10, "gone@raven.mail")];
    expect(liveAttachments(`<p>${img("one@raven.mail")}</p>`, files).map((f) => f.filename)).toEqual(["a.pdf", "one.png"]);
  });
});

describe("pruneInline", () => {
  test("drops images deleted from the body, and body images whose bytes are gone", () => {
    const files = [file("a.pdf", 10), file("kept.png", 10, "kept@raven.mail"), file("deleted.png", 10, "deleted@raven.mail")];
    const html = `<p>x${img("kept@raven.mail")}y${img("lost@raven.mail")}z</p>`;
    const out = pruneInline(html, files);
    expect(out.html).toBe(`<p>x${img("kept@raven.mail")}yz</p>`);
    expect(out.attachments.map((f) => f.filename)).toEqual(["a.pdf", "kept.png"]);
  });

  test("leaves what it was given untouched, so undo in compose still has the bytes", () => {
    const files = [file("deleted.png", 10, "deleted@raven.mail")];
    const html = "<p>no image now</p>";
    pruneInline(html, files);
    expect(files).toHaveLength(1);
    expect(files[0]!.cid).toBe("deleted@raven.mail");
  });

  test("one image shown twice is one file", () => {
    const files = [file("one.png", 10, "one@raven.mail")];
    const out = pruneInline(`<p>${img("one@raven.mail")}${img("one@raven.mail")}</p>`, files);
    expect(out.attachments).toHaveLength(1);
    expect(out.html.match(/<img/g)).toHaveLength(2);
  });
});

describe("limits", () => {
  const empty = { html: "", text: "", attachments: [] };

  test("the two builds' budgets sit under their request limits and match the promised file sizes", () => {
    expect(SEND_LIMITS.vercel.budget).toBeLessThan(4.5 * 1000 * 1000);
    expect(SEND_LIMITS.selfHosted.budget).toBeLessThan(26 * 1024 * 1024);
    expect(fileAllowanceMb(SEND_LIMITS.vercel.budget)).toBe(3);
    expect(fileAllowanceMb(SEND_LIMITS.selfHosted.budget)).toBe(18);
  });

  test("payloadSize counts the files as base64, plus the html and text", () => {
    const size = payloadSize({ text: "héllo", html: "<p>héllo</p>", attachments: [file("a.pdf", 300)] });
    expect(size).toBe(400 + 13 + 6 + 16_384);
  });

  test("files that fit are taken in order; the one that tips it over is turned away", () => {
    const budget = 16_384 + 1000;
    const { accepted, rejected } = planFiles(
      [
        { name: "a", size: 300, type: "application/pdf" },
        { name: "b", size: 600, type: "application/pdf" },
        { name: "c", size: 300, type: "application/pdf" },
      ],
      empty,
      budget,
    );
    expect(accepted.map((f) => f.name)).toEqual(["a", "c"]);
    expect(rejected).toEqual([{ name: "b", reason: "size" }]);
  });

  test("an image pasted and then deleted from the body no longer counts", () => {
    const budget = 16_384 + 1000;
    const deleted = file("deleted.png", 600, "deleted@raven.mail");
    const next = [{ name: "new.png", size: 600, type: "image/png" }];
    expect(planFiles(next, { html: "<p></p>", text: "", attachments: [deleted] }, budget).accepted).toHaveLength(1);
    expect(planFiles(next, { html: `<p>${img("deleted@raven.mail")}</p>`, text: "", attachments: [deleted] }, budget).rejected).toEqual([
      { name: "new.png", reason: "size" },
    ]);
  });

  test("the 21st file is turned away, and an image with nothing in it can't be read", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => file(`f${i}.pdf`, 3));
    const { accepted, rejected } = planFiles(
      [
        { name: "extra.pdf", size: 3, type: "application/pdf" },
        { name: "image.png", size: 0, type: "image/png" },
      ],
      { html: "", text: "", attachments: twenty },
    );
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([
      { name: "extra.pdf", reason: "count" },
      { name: "image.png", reason: "empty" },
    ]);
  });

  test("an empty text file is still a file", () => {
    expect(planFiles([{ name: "empty.txt", size: 0, type: "text/plain" }], empty).accepted).toHaveLength(1);
  });

  test("sendProblem speaks up for too many files and for too many bytes, else stays quiet", () => {
    expect(sendProblem({ text: "hi", attachments: [file("a.pdf", 30)] })).toBeNull();
    expect(sendProblem({ text: "hi", attachments: Array.from({ length: 21 }, () => file("a.pdf", 3)) })).toMatch(/up to 20 files/);
    expect(sendProblem({ text: "hi", attachments: [file("a.pdf", 3000)] }, 16_384 + 1000)).toMatch(/too big to send/);
  });
});

describe("pastedName", () => {
  const at = new Date(2026, 10, 18, 14, 32, 5);

  test("a clipboard screenshot gets a dated name with the right extension", () => {
    expect(pastedName({ name: "image.png", type: "image/png" }, at)).toBe("pasted-image-2026-11-18-143205.png");
    expect(pastedName({ name: "", type: "image/jpeg" }, at)).toBe("pasted-image-2026-11-18-143205.jpg");
  });

  test("a real file keeps its name, minus characters that would break the tag", () => {
    expect(pastedName({ name: "Q3 chart.webp", type: "image/webp" }, at)).toBe("Q3 chart.webp");
    expect(pastedName({ name: 'a"b<c>.png', type: "image/png" }, at)).toBe("abc.png");
  });
});

describe("adoptDataImages", () => {
  const cids = () => {
    let n = 0;
    return () => `c${++n}@raven.mail`;
  };

  test("a data: image becomes a cid image plus its bytes, keeping alt, width and the filename", () => {
    const html = `<p>Hi</p><p><img src="data:image/png;base64,aGVsbG8=" alt="shot &amp; more.png" width="560" style="max-width:100%;height:auto" /></p>`;
    const out = adoptDataImages(html, cids());
    expect(out.html).toBe(`<p>Hi</p><p><img src="cid:c1@raven.mail" alt="shot &amp; more.png" width="560"></p>`);
    expect(out.images).toEqual([
      { filename: "shot & more.png", contentType: "image/png", contentBase64: "aGVsbG8=", size: 5, cid: "c1@raven.mail", width: 560 },
    ]);
  });

  test("no data: URL is left behind: other image types are dropped, remote images pass through", () => {
    const html =
      `<img src="data:image/svg+xml;base64,PHN2Zy8+" alt="x.svg">` +
      `<img src="data:image/bmp;base64,Qk0=">` +
      `<img src="data:image/png,notbase64">` +
      `<img src="https://x.example/a.png" alt="remote">` +
      `<img src="data:image/gif;base64,R0lG">`;
    const out = adoptDataImages(html, cids());
    expect(out.html).not.toContain("data:");
    expect(out.html).toBe(`<img src="https://x.example/a.png" alt="remote"><img src="cid:c1@raven.mail" alt="image-1.gif">`);
    expect(out.images.map((i) => [i.filename, i.contentType, i.width])).toEqual([["image-1.gif", "image/gif", undefined]]);
  });

  test("a '>' inside a quoted value doesn't end the tag early", () => {
    const out = adoptDataImages(`<img alt="a > b" src="data:image/png;base64,AAAA">tail`, cids());
    expect(out.html).toBe(`<img src="cid:c1@raven.mail" alt="a  b.png">tail`);
  });

  test("an alt that describes the picture, with no extension, gets the type's own", () => {
    const out = adoptDataImages(`<img src="data:image/jpeg;base64,AAAA" alt="Team photo">`, cids());
    expect(out.images[0]!.filename).toBe("Team photo.jpg");
    expect(out.html).toBe(`<img src="cid:c1@raven.mail" alt="Team photo.jpg">`);
  });

  test("HTML without images, and a tag that never closes, come back as they were", () => {
    expect(adoptDataImages("<p>plain</p>").html).toBe("<p>plain</p>");
    expect(adoptDataImages(`<p>x</p><img src="data:image/png;base64,AAAA`).html).toBe(`<p>x</p><img src="data:image/png;base64,AAAA`);
  });

  test("a body of many megabytes is walked once, not searched over and over", () => {
    const big = "A".repeat(8_000_000);
    const html = `<p>start</p>${`<img src="data:image/png;base64,${big}" alt="big.png" width="560">`.repeat(3)}<p>end</p>`;
    const started = performance.now();
    const out = adoptDataImages(html, cids());
    expect(performance.now() - started).toBeLessThan(2000);
    expect(out.images.map((i) => i.contentBase64.length)).toEqual([8_000_000, 8_000_000, 8_000_000]);
    expect(out.html.length).toBeLessThan(300);
  });
});
