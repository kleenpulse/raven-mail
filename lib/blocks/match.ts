import type { BlockDTO } from "./types";

type Block = Pick<BlockDTO, "kind" | "value">;

/** Big shared providers: blocking one of these domains would hide half your mail. */
const SHARED_DOMAINS = new Set([
	"gmail.com",
	"googlemail.com",
	"outlook.com",
	"hotmail.com",
	"live.com",
	"msn.com",
	"yahoo.com",
	"ymail.com",
	"icloud.com",
	"me.com",
	"mac.com",
	"aol.com",
	"proton.me",
	"protonmail.com",
	"pm.me",
	"fastmail.com",
	"gmx.com",
	"gmx.net",
	"gmx.de",
	"web.de",
	"mail.com",
	"yandex.com",
	"yandex.ru",
	"zoho.com",
	"hey.com",
	"tutanota.com",
	"qq.com",
	"163.com",
]);

export function senderDomain(address: string): string {
	const at = address.lastIndexOf("@");
	return at < 0 ? "" : address.slice(at + 1).trim().toLowerCase();
}

/** Offer "block the whole domain" only where it can't catch friends or coworkers. */
export function canBlockDomain(address: string, self: string): boolean {
	const domain = senderDomain(address);
	return domain.includes(".") && !SHARED_DOMAINS.has(domain) && domain !== senderDomain(self);
}

/**
 * The block that covers a sender, if any. A domain block also covers its
 * subdomains (`acme.com` covers `mail.acme.com`, never `notacme.com`).
 */
export function blockMatcher<B extends Block>(blocks: readonly B[]): (address: string) => B | undefined {
	const addresses = new Map<string, B>();
	const domains = new Map<string, B>();
	for (const b of blocks) (b.kind === "address" ? addresses : domains).set(b.value.toLowerCase(), b);
	return (address) => {
		const a = address.trim().toLowerCase();
		const hit = addresses.get(a);
		if (hit || domains.size === 0) return hit;
		const labels = senderDomain(a).split(".");
		for (let i = 0; i < labels.length - 1; i++) {
			const d = domains.get(labels.slice(i).join("."));
			if (d) return d;
		}
		return undefined;
	};
}
