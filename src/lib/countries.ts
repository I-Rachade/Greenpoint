import { normalizeTogoPhone } from "@shared/phone";

/** A country offered in the dialling-code picker of the login page. */
export interface PhoneCountry {
  /** ISO 3166-1 alpha-2 code, also used to pick the flag. */
  code: string;
  /** Dialling code, "+228". */
  dial: string;
  name: { fr: string; en: string };
  /** How a national number looks, shown as placeholder. */
  example: string;
  /** Turns what was typed into an E.164 number, or null when it is not valid. */
  normalize: (input: string) => string | null;
}

/**
 * Countries people can sign in from. Only Togo for now: SMS abroad costs money
 * and invites toll fraud, and the worker and database accept only +228 numbers
 * (see lib/phone.ts). Adding a country here needs the same change there.
 */
export const PHONE_COUNTRIES: PhoneCountry[] = [
  {
    code: "TG",
    dial: "+228",
    name: { fr: "Togo", en: "Togo" },
    example: "90 12 34 56",
    normalize: normalizeTogoPhone,
  },
];

export const DEFAULT_PHONE_COUNTRY = PHONE_COUNTRIES[0];

/**
 * Reads the number typed next to the country picker. A number pasted with its
 * own "+…" or "00…" prefix must belong to the chosen country.
 */
export function phoneWithCountry(country: PhoneCountry, input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const phone = country.normalize(raw) ?? country.normalize(`${country.dial}${raw}`);
  return phone?.startsWith(country.dial) ? phone : null;
}
