"use client";

import { useState } from "react";

/**
 * Code entered in separate boxes. One real input lies over the boxes, so pasting,
 * SMS autofill (autocomplete="one-time-code") and the number keyboard all work.
 */
export function OtpInput({
  length,
  value,
  onChange,
  label,
  autoFocus,
}: {
  length: number;
  value: string;
  onChange: (value: string) => void;
  label: string;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative">
      <div className="flex justify-between gap-2" aria-hidden>
        {Array.from({ length }, (_, i) => {
          const current = focused && (i === value.length || (i === length - 1 && value.length === length));
          return (
            <span
              key={i}
              className={`flex h-14 flex-1 items-center justify-center rounded-xl border-2 bg-gp-surface text-2xl font-semibold transition-colors ${
                current
                  ? "border-gp-green-dark dark:border-gp-green"
                  : value[i]
                    ? "border-gp-green/50"
                    : "border-gp-border dark:border-white/15"
              }`}
            >
              {value[i] ?? ""}
            </span>
          );
        })}
      </div>
      <input
        aria-label={label}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        value={value}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, length))}
        required
      />
    </div>
  );
}
