"use client";

import dynamic from "next/dynamic";
import { useState, type FormEvent } from "react";
import { inServiceArea } from "@shared/drivers";
import type { LatLng } from "@shared/geo";
import { format } from "@/lib/i18n/format";
import {
  ADDRESS_LABEL_MAX,
  cleanAddressLabel,
  MAX_MERCHANT_ADDRESSES,
  MERCHANT_ADDRESS_MAX,
  type MerchantAddress,
  type MerchantAddressInput,
  type MerchantInfo,
  type MerchantShopInput,
} from "@shared/merchants";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { Notice } from "../drivers/shared";
import { useI18n } from "../i18n-provider";
import { Button } from "../ui";
import { Block, field, useAction } from "./shared";
import { ShopFields, useShopProblem } from "./shop-fields";

const HomePicker = dynamic(() => import("../drivers/home-picker").then((m) => m.HomePicker), { ssr: false });

/** Shop: name, phone, address and the pin (the start of every booking), and the saved addresses. */
export function MerchantShop({ shop, addresses }: { shop: MerchantInfo; addresses: MerchantAddress[] }) {
  const { t } = useI18n();
  const s = t.merchant.shopForm;
  const { backend } = useApp();
  const problemOf = useShopProblem();
  const { busy, run } = useAction();
  const [draft, setDraft] = useState<MerchantShopInput>({ name: shop.name, phone: shop.phone, address: shop.address, lat: shop.lat, lng: shop.lng });
  const [problem, setProblem] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const wrong = problemOf(draft);
    setProblem(wrong ?? "");
    if (wrong) return;
    void run(() => backend.updateMerchantShop({ ...draft, name: draft.name.trim(), address: draft.address.trim() }), s.saved);
  }

  return (
    <div className="space-y-4">
      <Block title={s.title} hint={s.hint}>
        <form onSubmit={submit} className="space-y-4">
          <ShopFields value={draft} onChange={setDraft} inputClass={field} />
          <Button type="submit" busy={busy}>
            {s.save}
          </Button>
          <Notice error={problem} notice="" />
        </form>
      </Block>
      <SavedAddresses shop={shop} addresses={addresses} />
    </div>
  );
}

const EMPTY_ADDRESS: MerchantAddressInput = { label: "", address: "", phone: "", lat: 0, lng: 0 };
const pinned = (p: LatLng) => p.lat !== 0 || p.lng !== 0;

/** Phase 2: other places the shop's parcels leave from, picked as the start when booking. */
function SavedAddresses({ shop, addresses }: { shop: MerchantInfo; addresses: MerchantAddress[] }) {
  const { t } = useI18n();
  const a = t.merchant.addresses;
  const [adding, setAdding] = useState(false);
  const full = addresses.length >= MAX_MERCHANT_ADDRESSES;
  return (
    <Block
      title={a.title}
      hint={format(a.hint, { max: MAX_MERCHANT_ADDRESSES })}
      action={
        !adding && (
          <Button variant="secondary" size="md" disabled={full} onClick={() => setAdding(true)}>
            {a.add}
          </Button>
        )
      }
    >
      {addresses.length === 0 ? (
        <p className="text-sm text-gp-muted">{a.none}</p>
      ) : (
        <ul className="space-y-2">
          {addresses.map((x) => (
            <AddressRow key={x.id} address={x} />
          ))}
        </ul>
      )}
      {full && <p className="text-xs text-gp-muted">{a.full}</p>}
      {adding && <AddressForm shop={shop} onDone={() => setAdding(false)} />}
    </Block>
  );
}

function AddressRow({ address: x }: { address: MerchantAddress }) {
  const { t } = useI18n();
  const a = t.merchant.addresses;
  const { backend } = useApp();
  const { busy, run } = useAction();
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-black/10 p-3 text-sm dark:border-white/10">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{x.label}</p>
        <p className="text-xs text-gp-muted">
          {x.address} · {x.phone}
        </p>
      </div>
      <Button variant="ghost" size="md" onClick={() => setConfirm(true)}>
        {a.remove}
      </Button>
      <ConfirmSheet
        open={confirm}
        title={format(a.removeTitle, { label: x.label })}
        confirmLabel={a.remove}
        danger
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          void run(() => backend.removeMerchantAddress(x.id), a.removed).then((ok) => {
            if (ok) setConfirm(false);
          })
        }
      >
        <p className="text-sm">{a.removeText}</p>
      </ConfirmSheet>
    </li>
  );
}

function AddressForm({ shop, onDone }: { shop: MerchantInfo; onDone: () => void }) {
  const { t } = useI18n();
  const a = t.merchant.addresses;
  const { backend } = useApp();
  const { busy, run } = useAction();
  // The shop's phone by default; the map opens on the shop.
  const [draft, setDraft] = useState<MerchantAddressInput>({ ...EMPTY_ADDRESS, phone: shop.phone });
  const [problem, setProblem] = useState("");
  const outside = pinned(draft) && !inServiceArea(draft);
  const set = (key: "label" | "address" | "phone") => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const address = draft.address.trim();
    const wrong = !cleanAddressLabel(draft.label)
      ? a.labelInvalid
      : address.length < 2 || address.length > MERCHANT_ADDRESS_MAX
        ? t.merchant.addressInvalid
        : !draft.phone.trim()
          ? t.login.invalidPhone
          : !pinned(draft) || !inServiceArea(draft)
            ? t.merchant.pinMissing
            : "";
    setProblem(wrong);
    if (wrong) return;
    void run(() => backend.addMerchantAddress({ ...draft, label: draft.label.trim(), address }), a.saved).then((ok) => {
      if (ok) onDone();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-black/10 p-3 dark:border-white/10">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{a.label}</span>
          <input className={field} maxLength={ADDRESS_LABEL_MAX} value={draft.label} onChange={set("label")} required />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{a.phone}</span>
          <input className={field} type="tel" inputMode="tel" placeholder="90 12 34 56" value={draft.phone} onChange={set("phone")} required />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{a.address}</span>
        <input className={field} autoComplete="street-address" maxLength={MERCHANT_ADDRESS_MAX} value={draft.address} onChange={set("address")} required />
      </label>
      <div className="space-y-2">
        <span className="text-sm font-medium">{a.pin}</span>
        <HomePicker value={pinned(draft) ? draft : null} onChange={(p: LatLng) => setDraft((d) => ({ ...d, lat: p.lat, lng: p.lng }))} flyTo={0} />
        <p className={`text-xs ${outside ? "text-red-600" : "text-gp-muted"}`}>{outside ? t.drivers.customer.outsideArea : t.drivers.customer.mapHint}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" busy={busy}>
          {a.save}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {a.cancel}
        </Button>
      </div>
      <Notice error={problem} notice="" />
    </form>
  );
}
