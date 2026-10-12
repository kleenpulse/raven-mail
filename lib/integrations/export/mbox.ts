/*
 * mboxrd writer. Each message:
 *   From <sender> <asctime date>\n
 *   <source, CRLF→LF, every ^>*From  line quoted with one more ">">
 *   \n    ← blank separator line
 * Chunks are always whole messages, so any prefix of the export is a valid file.
 */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** asctime(3) in UTC: `Thu Sep 24 09:05:07 2026`. */
export function asctime(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${DAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, " ")} ` +
		`${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ${date.getUTCFullYear()}`
	);
}

export function fromLine(sender: string | undefined, date: Date | undefined): string {
	const who = sender?.trim().replace(/\s+/g, "_") || "MAILER-DAEMON";
	const when = date && !Number.isNaN(date.getTime()) ? date : new Date(0);
	return `From ${who} ${asctime(when)}\n`;
}

/**
 * One message as mbox bytes. latin1 maps bytes 1:1 onto chars, so 8-bit bodies
 * survive the regex round-trip untouched — never decode mail as UTF-8 here.
 */
export function encodeMessage(source: Uint8Array, meta: { sender?: string; date?: Date }): Buffer {
	let text = Buffer.from(source.buffer, source.byteOffset, source.byteLength).toString("latin1");
	text = text.replace(/\r\n/g, "\n").replace(/^(>*From )/gm, ">$1");
	if (!text.endsWith("\n")) text += "\n";
	return Buffer.from(`${fromLine(meta.sender, meta.date)}${text}\n`, "latin1");
}

export function exportFileName(folder: string, date: Date): string {
	const slug =
		folder
			.split(/[/.]/)
			.pop()!
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || "mailbox";
	return `raven-${slug}-${date.toISOString().slice(0, 10)}.mbox`;
}
