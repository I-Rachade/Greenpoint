"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { TripPayment } from "@/lib/drivers";
import { format } from "@/lib/i18n/format";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";
import { useFcfa } from "./shared";

/**
 * How the customer pays a trip (planung/fahrer.md phase 2): cash to the driver, or from the
 * wallet they top up with Flooz or T-Money. Hidden for shops and when the wallet is off.
 */
export function TripPaymentChoice({ fare, value, onChange }: { fare: number | null; value: TripPayment; onChange: (v: TripPayment) => void }) {
  const { t } = useI18n();
  const p = t.drivers.pay;
  const { backend, profile } = useApp();
  const fcfa = useFcfa();
  // undefined while loading, null when the wallet is not open to this account.
  const [balance, setBalance] = useState<number | null | undefined>(undefined);
  const merchant = profile?.role === "merchant";

  useEffect(() => {
    if (merchant) return;
    let active = true;
    const load = () =>
      backend
        .myWallet()
        .then((w) => active && setBalance(w.frozen ? null : w.balanceXof))
        .catch(() => active && setBalance(null));
    void load();
    const unsubscribe = backend.subscribe(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [backend, merchant]);

  if (merchant || balance == null) return null;
  const short = value === "wallet" && fare !== null && fare > balance;
  const option = (v: TripPayment, label: string, hint?: string) => (
    <label
      className={`flex flex-1 cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm ${value === v ? "border-gp-green bg-gp-green/5" : "border-black/10 dark:border-white/10"}`}
    >
      <input type="radio" name="trip-payment" className="mt-0.5 accent-gp-green" checked={value === v} onChange={() => onChange(v)} />
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-xs text-gp-muted">{hint}</span>}
      </span>
    </label>
  );
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm">{p.title}</legend>
      <div className="flex flex-col gap-2 sm:flex-row">
        {option("cash", p.cash)}
        {option("wallet", p.wallet, format(p.balance, { amount: fcfa(balance) }))}
      </div>
      {short && (
        <p className="text-xs text-red-600">
          {p.short}{" "}
          <Link href="/portefeuille" className="font-medium underline">
            {p.topup}
          </Link>
        </p>
      )}
    </fieldset>
  );
}
