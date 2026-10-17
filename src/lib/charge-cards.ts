// Charging cards: a customer swipes a card at an OCPP charge point and the charge starts
// without the app. An admin links each card to a customer account in the backoffice; the
// charge is then that customer's and is paid like any other. A card nobody linked yet is
// listed after its first swipe, so its number can be read off the backoffice.
// Shared by the app, the demo backend and the Worker (worker/charge-cards.ts).

import { OCPP_TAG_PREFIX } from "./iot/ocpp";

export interface ChargeCard {
  /** The card number as the charge point sends it, upper case. */
  idTag: string;
  label: string | null;
  blocked: boolean;
  /** Null until an admin links the card; such a card never charges. */
  customer: { id: string; fullName: string | null; phone: string | null; email: string | null } | null;
  createdAt: string;
  lastSwipedAt: string | null;
  /** The charge point it was last swiped at. */
  lastDevice: string | null;
}

export interface ChargeCardInput {
  idTag: string;
  /** Phone number or e-mail address of the customer's account. */
  contact: string;
  label?: string | null;
}

/**
 * A card number as stored and compared: without spaces, colons or dashes, upper case, at
 * most 20 characters (OCPP idTag). Null when it cannot be a card, including our own
 * remote start tags ("PDR…").
 */
export function cleanCardTag(raw: string): string | null {
  const tag = raw.replace(/[\s:-]/g, "").toUpperCase();
  if (!/^[\x21-\x7E]{1,20}$/.test(tag) || tag.startsWith(OCPP_TAG_PREFIX)) return null;
  return tag;
}

/** Cards that still need a customer first, then the most recently swiped or added. */
export function sortCards(cards: ChargeCard[]): ChargeCard[] {
  const at = (c: ChargeCard) => c.lastSwipedAt ?? c.createdAt;
  return [...cards].sort((a, b) => Number(!!a.customer) - Number(!!b.customer) || at(b).localeCompare(at(a)));
}
