/** The usual "-- " line (RFC 3676 §4.3): mail clients use it to fold or strip a signature. */
export const SIGNATURE_DELIMITER = "-- ";

export const SIGNATURE_MAX = 1000;

function block(signature: string): string | null {
  const sig = signature.replace(/\s+$/, "");
  return sig.trim() ? `${SIGNATURE_DELIMITER}\n${sig}` : null;
}

/**
 * The text box's starting text with the signature at the end. A reply's quote
 * is kept apart and added below the text when sent, so this puts the
 * signature above the quoted original. Never adds it twice.
 */
export function withSignature(text: string, signature: string): string {
  const sig = block(signature);
  if (!sig || text.includes(sig)) return text;
  const lead = text.replace(/\s+$/, "");
  return `${lead}\n\n${sig}`;
}

/** Nothing typed above the signature yet: the caret belongs at the very start. */
export function onlySignature(text: string): boolean {
  return /^\s*-- \n/.test(text);
}
