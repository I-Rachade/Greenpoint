"use client";

import { format } from "@/lib/i18n/format";
import { PARCEL_SIZES, type ParcelSize, type ParcelSizeTier } from "@/lib/parcels";
import { useI18n } from "../i18n-provider";

/** Big S / M / L / XL buttons with each size's limits and price; staff pick one instead of measuring, customers say what they send. */
export function SizePicker({
  tiers,
  value,
  onChange,
  extraFcfa = 0,
  label,
  hidePrice,
}: {
  tiers: ParcelSizeTier[];
  value: ParcelSize | null;
  onChange: (size: ParcelSize) => void;
  /** Added to each price shown, e.g. the driver's fare. */
  extraFcfa?: number;
  /** Instead of "Taille du colis". */
  label?: string;
  /** When the price does not depend on the size. */
  hidePrice?: boolean;
}) {
  const { t } = useI18n();
  const sorted = [...tiers].sort((a, b) => PARCEL_SIZES.indexOf(a.size) - PARCEL_SIZES.indexOf(b.size));
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm">{label ?? t.parcels.staff.size}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {sorted.map((tier) => {
          const selected = value === tier.size;
          return (
            <button
              key={tier.size}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(tier.size)}
              className={`rounded-xl border p-3 text-left ${
                selected
                  ? "border-gp-green-dark bg-gp-green-dark text-white"
                  : "border-black/15 bg-white hover:border-gp-green-dark dark:border-white/20 dark:bg-zinc-900"
              }`}
            >
              <span className="block text-2xl font-bold">{tier.size}</span>
              <span className={`block text-xs ${selected ? "text-white/80" : "text-zinc-500"}`}>
                {format(t.parcels.staff.sizeLimits, {
                  l: tier.maxLengthCm,
                  w: tier.maxWidthCm,
                  h: tier.maxHeightCm,
                  kg: tier.maxWeightKg,
                })}
              </span>
              {!hidePrice && <span className="mt-1 block text-sm font-semibold">{tier.priceFcfa + extraFcfa} FCFA</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
