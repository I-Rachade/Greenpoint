"use client";

import { useState, type FormEvent } from "react";
import type { MerchantInfo, MerchantShopInput } from "@/lib/merchants";
import { useApp } from "../app-provider";
import { Notice } from "../drivers/shared";
import { useI18n } from "../i18n-provider";
import { Button } from "../ui";
import { Block, field, useAction } from "./shared";
import { ShopFields, useShopProblem } from "./shop-fields";

/** Shop: name, phone, address and the pin (the start of every booking). */
export function MerchantShop({ shop }: { shop: MerchantInfo }) {
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
    <Block title={s.title} hint={s.hint}>
      <form onSubmit={submit} className="space-y-4">
        <ShopFields value={draft} onChange={setDraft} inputClass={field} />
        <Button type="submit" busy={busy}>
          {s.save}
        </Button>
        <Notice error={problem} notice="" />
      </form>
    </Block>
  );
}
