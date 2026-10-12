const TOGO_PREFIX = "+228";

/**
 * Normalises a Togolese phone number to E.164 (+228XXXXXXXX), or returns null.
 * Accepts "90 12 34 56", "90123456", "+228 90 12 34 56", "00228…" and "228…".
 */
export function normalizeTogoPhone(input: string): string | null {
  let digits = input.replace(/[\s.\-()]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (digits.startsWith("+")) {
    if (!digits.startsWith(TOGO_PREFIX)) return /^\+\d{8,15}$/.test(digits) ? digits : null;
    digits = digits.slice(TOGO_PREFIX.length);
  } else if (digits.length === 11 && digits.startsWith("228")) {
    digits = digits.slice(3);
  }
  return /^\d{8}$/.test(digits) ? `${TOGO_PREFIX}${digits}` : null;
}
