export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127\./.test(h);
}

function ipv4Octets(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN));
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

/** Addresses a public mail server should never resolve to (SSRF guard). */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const v4 = ipv4Octets(mapped ? mapped[1]! : addr);
  if (v4) {
    const [a, b] = v4 as [number, number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (!addr.includes(":")) return false;
  // IPv4 carried inside IPv6: ::ffff:7f00:1 (hex-mapped) and 64:ff9b::a.b.c.d (NAT64).
  const embedded = embeddedIpv4(addr);
  if (embedded) return isPrivateAddress(embedded);
  return (
    addr === "::" ||
    addr === "::1" ||
    /^f[cd][0-9a-f]{2}:/.test(addr) ||
    /^fe[89ab][0-9a-f]:/.test(addr) ||
    /^fe[c-f][0-9a-f]:/.test(addr) ||
    /^ff[0-9a-f]{2}:/.test(addr) ||
    /^100::/.test(addr) ||
    /^2001:0?db8:/.test(addr)
  );
}

function embeddedIpv4(addr: string): string | null {
  // 6to4 (2002:AABB:CCDD::/48) carries the IPv4 in groups 2–3.
  const sixToFour = addr.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/);
  if (sixToFour) return hexPairToIpv4(sixToFour[1]!, sixToFour[2]!);
  // Mapped (::ffff:), NAT64 (64:ff9b::) and the deprecated IPv4-compatible (::) forms.
  const hex = addr.match(/^(?:::ffff:|64:ff9b::|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) return hexPairToIpv4(hex[1]!, hex[2]!);
  const dotted = addr.match(/^(?:64:ff9b::|::)(\d+\.\d+\.\d+\.\d+)$/);
  return dotted ? dotted[1]! : null;
}

function hexPairToIpv4(high: string, low: string): string {
  const hi = parseInt(high, 16);
  const lo = parseInt(low, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}
