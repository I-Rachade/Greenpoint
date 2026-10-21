"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { inServiceArea } from "@/lib/drivers";
import type { LatLng } from "@/lib/geo";
import { cleanMerchantName, MERCHANT_ADDRESS_MAX, MERCHANT_NAME_MAX, type MerchantShopInput } from "@/lib/merchants";
import { usePosition } from "@/lib/use-position";
import { useI18n } from "../i18n-provider";

const HomePicker = dynamic(() => import("../drivers/home-picker").then((m) => m.HomePicker), { ssr: false });

export const EMPTY_SHOP: MerchantShopInput = { name: "", phone: "", address: "", lat: 0, lng: 0 };

const pinned = (p: LatLng) => p.lat !== 0 || p.lng !== 0;

/** What is wrong with the shop as typed (an i18n text), or null when it can be sent. */
export function useShopProblem() {
  const { t } = useI18n();
  const m = t.merchant;
  return (shop: MerchantShopInput): string | null => {
    if (!cleanMerchantName(shop.name)) return m.nameInvalid;
    if (!shop.phone.trim()) return t.login.invalidPhone;
    const address = shop.address.trim();
    if (address.length < 2 || address.length > MERCHANT_ADDRESS_MAX) return m.addressInvalid;
    if (!pinned(shop) || !inServiceArea(shop)) return m.pinMissing;
    return null;
  };
}

/**
 * The shop's name, phone, address and its pin on the map (registration and the Shop
 * section). Drivers come to the pin; it is also the start of every booking.
 */
export function ShopFields({ value, onChange, inputClass }: { value: MerchantShopInput; onChange: (shop: MerchantShopInput) => void; inputClass: string }) {
  const { t } = useI18n();
  const m = t.merchant;
  const { position } = usePosition();
  // A saved shop opens centred on its pin.
  const [flyTo, setFlyTo] = useState(() => (pinned(value) ? 1 : 0));
  const outside = pinned(value) && !inServiceArea(value);
  const set = (key: "name" | "phone" | "address") => (e: { target: { value: string } }) => onChange({ ...value, [key]: e.target.value });
  return (
    <div className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{m.shopName}</span>
        <input className={inputClass} autoComplete="organization" maxLength={MERCHANT_NAME_MAX} value={value.name} onChange={set("name")} required />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{m.shopPhone}</span>
        <input className={inputClass} type="tel" inputMode="tel" placeholder="90 12 34 56" value={value.phone} onChange={set("phone")} required />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{m.shopAddress}</span>
        <input className={inputClass} autoComplete="street-address" maxLength={MERCHANT_ADDRESS_MAX} value={value.address} onChange={set("address")} required />
      </label>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1 text-sm font-medium">{m.shopPin}</span>
          <button
            type="button"
            className="rounded-full border border-gp-border px-3 py-1 text-xs font-medium disabled:opacity-40 dark:border-white/20"
            disabled={!position}
            onClick={() => {
              if (!position) return;
              onChange({ ...value, lat: position.lat, lng: position.lng });
              setFlyTo((n) => n + 1);
            }}
          >
            📍 {t.drivers.customer.myPosition}
          </button>
        </div>
        <HomePicker value={pinned(value) ? value : null} onChange={(p: LatLng) => onChange({ ...value, lat: p.lat, lng: p.lng })} flyTo={flyTo} />
        <p className={`text-xs ${outside ? "text-red-600" : "text-gp-muted"}`}>{outside ? t.drivers.customer.outsideArea : m.shopPinHint}</p>
      </div>
    </div>
  );
}
