/** The live trip screen of a reservation (src/components/en-route.tsx). */
export function enRouteHref(reservationId: string): string {
  return `/en-route?id=${encodeURIComponent(reservationId)}`;
}
