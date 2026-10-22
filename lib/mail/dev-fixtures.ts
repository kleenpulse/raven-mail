import type { AttachmentMeta } from "@/lib/mail/types";

/*
 * Bytes for the dev mailbox's seeded attachments, which only carry metadata.
 * PDF, PNG, calendar and text files open for real; anything else (docx, zip)
 * gets a short text body, since building those formats isn't worth it here.
 */

const encoder = new TextEncoder();

// A 1x1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const pdfText = (s: string) => s.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, "\\$&");

/** A one-page PDF with real xref offsets, so viewers open it without repair. */
function pdf(title: string): Uint8Array {
  const content = [
    `BT /F1 18 Tf 72 720 Td (${pdfText(title)}) Tj ET`,
    "BT /F1 11 Tf 72 696 Td (Sample file from the Raven dev mailbox.) Tj ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return encoder.encode(out);
}

function ics(title: string): Uint8Array {
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  return encoder.encode(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Raven//Dev mailbox//EN",
      "BEGIN:VEVENT",
      `UID:${stamp}-dev@localhost`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${stamp}`,
      `SUMMARY:${title.replace(/[\r\n,;\\]/g, " ")}`,
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  );
}

export function fixtureBytes(meta: Pick<AttachmentMeta, "filename" | "contentType">): Uint8Array {
  const type = meta.contentType.toLowerCase();
  if (type === "application/pdf") return pdf(meta.filename);
  if (type === "image/png") return Uint8Array.from(Buffer.from(PNG, "base64"));
  if (type === "text/calendar") return ics(meta.filename);
  if (type === "image/svg+xml") {
    return encoder.encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#888"/></svg>\n',
    );
  }
  return encoder.encode(`${meta.filename}\n\nSample file from the Raven dev mailbox.\n`);
}
