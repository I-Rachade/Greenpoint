import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { ChevronIcon } from "./icons";

type Icon = ComponentType<{ size?: number }>;

/** Titled group of rows in a rounded card (account and settings screens). */
export function MenuGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      {title && <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-gp-muted">{title}</h2>}
      <ul className="divide-y divide-gp-border overflow-hidden rounded-2xl border border-gp-border bg-gp-surface shadow-sm dark:divide-white/10 dark:border-white/10">
        {children}
      </ul>
    </section>
  );
}

const rowClass = "flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-black/[.03] dark:hover:bg-white/5";

function RowBody({ icon: Icon, label, value, danger }: { icon: Icon; label: string; value?: ReactNode; danger?: boolean }) {
  return (
    <>
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          danger ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400" : "bg-gp-green/10 text-gp-green-dark dark:text-gp-green"
        }`}
      >
        <Icon size={18} />
      </span>
      <span className={`flex-1 text-sm font-medium ${danger ? "text-red-700 dark:text-red-400" : ""}`}>{label}</span>
      {value !== undefined && <span className="text-sm text-gp-muted dark:text-zinc-400">{value}</span>}
    </>
  );
}

/** A row that opens a page. */
export function MenuLink({ href, icon, label, value }: { href: string; icon: Icon; label: string; value?: ReactNode }) {
  return (
    <li>
      <Link href={href} className={rowClass}>
        <RowBody icon={icon} label={label} value={value} />
        <ChevronIcon size={18} className="text-gp-muted" />
      </Link>
    </li>
  );
}

/** A row that runs an action. */
export function MenuButton({
  onClick,
  icon,
  label,
  value,
  danger,
}: {
  onClick: () => void;
  icon: Icon;
  label: string;
  value?: ReactNode;
  danger?: boolean;
}) {
  return (
    <li>
      <button type="button" onClick={onClick} className={rowClass}>
        <RowBody icon={icon} label={label} value={value} danger={danger} />
      </button>
    </li>
  );
}

/** A row with its own control on the right (e.g. a segmented choice). */
export function MenuItem({ icon, label, children }: { icon: Icon; label: string; children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <RowBody icon={icon} label={label} />
      {children}
    </li>
  );
}

/** Small segmented control (language, theme). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full bg-gp-border/60 p-0.5 dark:bg-white/10">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            value === o.value ? "bg-gp-surface text-gp-forest shadow-sm dark:text-zinc-50" : "text-gp-muted dark:text-zinc-400"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
