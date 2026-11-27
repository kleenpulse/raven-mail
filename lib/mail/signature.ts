export const SIGNATURE_DELIMITER = "-- ";

export const SIGNATURE_MAX = 1000;

function block(signature: string): string | null {
  const sig = signature.replace(/\s+$/, "");
  return sig.trim() ? `${SIGNATURE_DELIMITER}\n${sig}` : null;
}

export function withSignature(text: string, signature: string): string {
  const sig = block(signature);
  if (!sig || text.includes(sig)) return text;
  const lead = text.replace(/\s+$/, "");
  return `${lead}\n\n${sig}`;
}

export function onlySignature(text: string): boolean {
  return /^\s*-- \n/.test(text);
}
