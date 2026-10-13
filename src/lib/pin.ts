/** Login PIN: four digits, like the mobile money PINs customers already know. */
export const PIN_LENGTH = 4;

export function validPinFormat(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

/** PINs too easy to guess: one digit repeated, or a run like 1234 / 4321. */
export function weakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const steps = [...pin].slice(1).map((d, i) => Number(d) - Number(pin[i]));
  return steps.every((s) => s === 1) || steps.every((s) => s === -1);
}
