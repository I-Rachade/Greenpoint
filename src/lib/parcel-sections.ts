/** The pages of the station parcel counter (/operator/colis/<section>), one job each. */
export const PARCEL_SECTIONS = ["nouveau", "remettre", "annonces", "expedier", "arrivees", "a-retirer", "chauffeurs", "historique"] as const;

export type ParcelSection = (typeof PARCEL_SECTIONS)[number];

export function isParcelSection(value: string): value is ParcelSection {
  return (PARCEL_SECTIONS as readonly string[]).includes(value);
}
