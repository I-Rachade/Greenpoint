"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useI18n } from "./i18n-provider";

/* Small shared building blocks for every screen. Colours, radii and motion come from globals.css. */

// ---------- Motion ----------

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void) {
  const media = window.matchMedia(REDUCED_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** True when the phone asks for less motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}

// ---------- Button ----------

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-gp-green-dark text-white hover:bg-gp-forest dark:hover:bg-gp-green dark:hover:text-gp-forest",
  secondary: "border border-gp-border bg-gp-surface text-gp-forest hover:bg-black/5 dark:text-zinc-100 dark:hover:bg-white/10",
  ghost: "text-gp-green-dark hover:bg-gp-green/10 dark:text-gp-green",
  danger: "bg-gp-closed text-white hover:bg-red-700",
};

const SIZES: Record<Size, string> = {
  sm: "min-h-9 px-3 text-sm",
  md: "min-h-11 px-5 text-sm",
  lg: "min-h-12 px-6 text-base",
};

/** Class names of a Button, for the rare element that cannot be one. */
export function buttonClass(variant: Variant = "primary", size: Size = "md", className = ""): string {
  return `inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[background-color,color,transform,opacity] duration-160 ease-gp-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
}

function Spinner() {
  return <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and blocks clicks while an action runs. */
  busy?: boolean;
  /** Renders a Next Link instead of a button. */
  href?: string;
};

/** Pill button (primary, secondary, ghost, danger); md and lg are at least 44px tall. */
export function Button({ variant = "primary", size = "md", busy = false, href, className = "", children, disabled, type = "button", ...rest }: ButtonProps) {
  const classes = buttonClass(variant, size, className);
  if (href) {
    return (
      <Link href={href} className={classes} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} className={classes} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}

// ---------- Input ----------

/** Text field: 16px text so iOS does not zoom, 44px tall, green border when focused. */
export function Input({ className = "", ...rest }: ComponentProps<"input">) {
  return (
    <input
      className={`min-h-11 w-full rounded-xl border border-gp-border bg-gp-surface px-4 py-2.5 text-base outline-none transition-colors duration-160 placeholder:text-gp-muted focus:border-gp-green-dark focus-visible:ring-2 focus-visible:ring-gp-green/40 aria-[invalid=true]:border-gp-closed dark:focus:border-gp-green ${className}`}
      {...rest}
    />
  );
}

// ---------- Card ----------

/** White rounded card used across the redesigned screens. */
export function Card({ children, className = "", ...rest }: ComponentProps<"div">) {
  return (
    <div className={`rounded-2xl border border-gp-border bg-gp-surface shadow-sm ${className}`} {...rest}>
      {children}
    </div>
  );
}

// ---------- Badge ----------

export type BadgeTone = "green" | "amber" | "red" | "blue" | "neutral";

const TONES: Record<BadgeTone, string> = {
  green: "bg-gp-green/15 text-gp-green-dark dark:text-gp-green",
  amber: "bg-gp-low/15 text-amber-800 dark:text-amber-300",
  red: "bg-gp-closed/15 text-red-700 dark:text-red-300",
  blue: "bg-gp-info/15 text-blue-700 dark:text-blue-300",
  neutral: "bg-black/5 text-gp-muted dark:bg-white/10",
};

/** Small status pill. */
export function Badge({ tone = "neutral", children, className = "" }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${TONES[tone]} ${className}`}>{children}</span>;
}

// ---------- Skeleton ----------

/** Shimmering placeholder block; size it with className (e.g. "h-4 w-32"). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`gp-skeleton block rounded-gp-sm ${className}`} />;
}

/** A few placeholder text lines, the last one shorter. */
export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-3.5 ${i === lines - 1 && lines > 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </span>
  );
}

/** Placeholder shaped like a list card (icon, two lines). */
export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <Card className={`flex items-center gap-3 p-4 ${className}`} aria-hidden>
      <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
      <SkeletonText lines={2} className="flex-1" />
    </Card>
  );
}

// ---------- EmptyState ----------

/** Nothing to show yet: round icon, title, short text and an optional action. */
export function EmptyState({ icon, title, text, action, className = "" }: { icon?: ReactNode; title?: string; text?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={`animate-gp-fade-in mt-10 flex flex-col items-center gap-3 text-center ${className}`}>
      {icon && <span className="flex h-20 w-20 items-center justify-center rounded-full bg-gp-green/15 text-gp-green-dark dark:text-gp-green">{icon}</span>}
      {title && <p className="font-semibold">{title}</p>}
      {text && <p className="max-w-xs text-sm text-gp-muted">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// ---------- Toast ----------

export type ToastTone = "success" | "error" | "info";
export interface ToastOptions {
  tone?: ToastTone;
  /** Adds an "Undo" button that calls this. */
  onUndo?: () => void;
  /** Milliseconds before it goes away (3000; 5000 with Undo). */
  duration?: number;
}
interface ToastState extends ToastOptions {
  id: number;
  message: string;
}

const ToastContext = createContext<((message: string, options?: ToastOptions) => void) | null>(null);

/** Short confirmation at the bottom of the screen; one at a time. Mounted once in layout.tsx. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toast, setToast] = useState<ToastState | null>(null);
  const nextId = useRef(0);

  const show = useCallback((message: string, options: ToastOptions = {}) => {
    nextId.current += 1;
    setToast({ id: nextId.current, message, ...options });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), toast.duration ?? (toast.onUndo ? 5000 : 3000));
    return () => window.clearTimeout(id);
  }, [toast]);

  const dot = toast?.tone === "error" ? "bg-gp-closed" : toast?.tone === "info" ? "bg-gp-info" : "bg-gp-green";
  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* Always mounted so screen readers announce each new message. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 md:bottom-6"
      >
        {toast && (
          <div
            key={toast.id}
            className="animate-gp-slide-up pointer-events-auto flex max-w-md items-center gap-3 rounded-gp-md bg-gp-forest py-2 pr-2 pl-4 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-gp-forest"
          >
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
            <span className="min-w-0 flex-1 py-1.5">{toast.message}</span>
            {toast.onUndo ? (
              <button
                type="button"
                onClick={() => {
                  toast.onUndo?.();
                  setToast(null);
                }}
                className="min-h-11 rounded-full px-3 font-semibold text-gp-green dark:text-gp-green-dark"
              >
                {t.ui.undo}
              </button>
            ) : (
              <button type="button" onClick={() => setToast(null)} aria-label={t.ui.dismiss} className="flex h-11 w-11 items-center justify-center rounded-full opacity-70 hover:opacity-100">
                <span aria-hidden>✕</span>
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

/** Returns toast(message, { tone, onUndo, duration }). */
export function useToast(): (message: string, options?: ToastOptions) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast needs <ToastProvider>");
  return show;
}

// ---------- SuccessCheck ----------

/** Green circle whose check mark draws itself (instant with reduced motion). */
export function SuccessCheck({ size = 72, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 52 52" aria-hidden className={`animate-gp-pop ${className}`}>
      <circle cx="26" cy="26" r="25" className="fill-gp-green" />
      <path d="M15 27l7 7 15-16" pathLength={1} fill="none" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" className="animate-gp-check stroke-gp-forest" />
    </svg>
  );
}

// ---------- Count up ----------

/** Number that glides (~400ms) from its previous value to `value`; jumps with reduced motion. */
export function useCountUp(value: number, { duration = 400, decimals = 0 }: { duration?: number; decimals?: number } = {}): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const current = useRef(value);

  useEffect(() => {
    const from = current.current;
    if (reduced || from === value) {
      current.current = value;
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const v = from + (value - from) * (1 - (1 - p) ** 3);
      current.current = v;
      setShown(v);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduced]);

  const factor = 10 ** decimals;
  return Math.round((reduced ? value : shown) * factor) / factor;
}

/** <span> with tabular digits showing useCountUp(value); `format` turns the number into text. */
export function CountUp({ value, format = String, decimals = 0, className = "" }: { value: number; format?: (n: number) => string; decimals?: number; className?: string }) {
  const n = useCountUp(value, { decimals });
  return <span className={`tabular-nums ${className}`}>{format(n)}</span>;
}

// ---------- Countdown ----------

function toTime(at: number | string | Date | null | undefined): number | null {
  if (at === null || at === undefined) return null;
  const ms = at instanceof Date ? at.getTime() : typeof at === "number" ? at : Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
}

/** Milliseconds left until `expiresAt` (0 once passed, null without a date); updates every second. */
export function useCountdown(expiresAt: number | string | Date | null | undefined): number | null {
  const end = toTime(expiresAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (end === null) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [end]);
  return end === null ? null : Math.max(0, end - now);
}

/** "4:05" or "1:02:09". */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Remaining time as m:ss with tabular digits. */
export function Countdown({ expiresAt, className = "" }: { expiresAt: number | string | Date | null | undefined; className?: string }) {
  const left = useCountdown(expiresAt);
  if (left === null) return null;
  return (
    <span role="timer" className={`tabular-nums ${className}`}>
      {formatRemaining(left)}
    </span>
  );
}

// ---------- ProgressRing ----------

/** Circular progress (value 0–1) in the current text colour (text-gp-green by default), content in the middle. */
export function ProgressRing({
  value,
  size = 56,
  stroke = 5,
  label,
  children,
  className = "text-gp-green",
}: {
  value: number;
  size?: number;
  stroke?: number;
  /** Accessible name, e.g. "Temps restant". */
  label?: string;
  children?: ReactNode;
  className?: string;
}) {
  const clamped = Math.min(1, Math.max(0, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = `${c} ${c}`;
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-gp-border" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={dash}
          strokeDashoffset={c * (1 - clamped)}
          className="transition-[stroke-dashoffset] duration-360 ease-gp-out"
        />
      </svg>
      {children !== undefined && <span className="relative text-xs font-semibold text-foreground tabular-nums">{children}</span>}
    </span>
  );
}
