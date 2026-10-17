// Charging cards with their own credit: a customer swipes a card at an OCPP charge point and
// the charge starts without the app, if the balance covers the station's minimum price. The
// charge stops when the credit is used up and is paid from the card. Station staff top cards
// up in cash; a card may be linked to a customer account but does not need one. A card is
// listed after its first swipe, so its number can be read off the backoffice and the counter.
// Shared by the app, the demo backend and the Worker (worker/charge-cards.ts).

import { OCPP_TAG_PREFIX } from "./iot/ocpp";

export interface ChargeCard {
  /** The card number as the charge point sends it, upper case. */
  idTag: string;
  label: string | null;
  blocked: boolean;
  /** Credit in FCFA; below 0 after a stop that reached the charge point late. */
  balanceXof: number;
  /** The customer the card belongs to, if an admin linked one. */
  customer: { id: string; fullName: string | null; phone: string | null; email: string | null } | null;
  createdAt: string;
  lastSwipedAt: string | null;
  /** The charge point it was last swiped at. */
  lastDevice: string | null;
}

export interface ChargeCardInput {
  idTag: string;
  /** Phone number or e-mail address of the customer's account; empty: no customer. */
  contact?: string | null;
  label?: string | null;
}

/** What station staff see of a card at the counter. */
export interface CounterCard {
  idTag: string;
  label: string | null;
  blocked: boolean;
  balanceXof: number;
}

/** Top-ups at the counter: whole FCFA amounts in multiples of 5, up to this. */
export const MAX_CARD_TOPUP_XOF = 500_000;

export function validTopup(amount: number): boolean {
  return Number.isInteger(amount) && amount >= 5 && amount <= MAX_CARD_TOPUP_XOF && amount % 5 === 0;
}

/** An admin correction: a non-zero multiple of 5, either way. */
export function validAdjustment(amount: number): boolean {
  return Number.isInteger(amount) && amount !== 0 && Math.abs(amount) <= MAX_CARD_TOPUP_XOF && amount % 5 === 0;
}

/**
 * The price at which a card charge is stopped: the energy's price without the station's
 * minimum, so a balance equal to the minimum still charges up to that amount.
 */
export function cardStopReached(energyWh: number, kwhXof: number, balanceXof: number): boolean {
  return balanceXof <= 0 || Math.ceil((energyWh / 1000) * kwhXof) >= balanceXof;
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

/** The most recently swiped or added first. */
export function sortCards(cards: ChargeCard[]): ChargeCard[] {
  const at = (c: ChargeCard) => c.lastSwipedAt ?? c.createdAt;
  return [...cards].sort((a, b) => at(b).localeCompare(at(a)));
}
