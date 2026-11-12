/** The pages of the station parcel counter (/operator/colis/<section>), one job each. */
export const PARCEL_SECTIONS = [
  "nouveau",
  "remettre",
  "annonces",
  "expedier",
  "arrivees",
  "a-retirer",
  "chauffeurs",
  "chauffeur-comptoir",
  "chauffeur-remettre",
  "chauffeur-apportes",
  "chauffeur-file",
  "historique",
] as const;

export type ParcelSection = (typeof PARCEL_SECTIONS)[number];

export function isParcelSection(value: string): value is ParcelSection {
  return (PARCEL_SECTIONS as readonly string[]).includes(value);
}

/** The driver pages, reached from the "Chauffeurs" tile. */
export type DriverPart = Extract<ParcelSection, `chauffeur-${string}`>;

export function isDriverPart(section: ParcelSection): section is DriverPart {
  return section.startsWith("chauffeur-");
}
