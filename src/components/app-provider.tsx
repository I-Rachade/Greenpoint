"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getBackend, type Backend } from "@/lib/backend";
import type { Profile } from "@/lib/types";

interface AppContextValue {
  backend: Backend;
  profile: Profile | null;
  /** False until the stored session has been checked. */
  ready: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

function sameProfile(a: Profile | null, b: Profile | null): boolean {
  return a === b || (!!a && !!b && a.id === b.id && a.role === b.role && a.phone === b.phone && a.fullName === b.fullName);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [backend] = useState(getBackend);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    // Keep the previous object when nothing changed. Otherwise every reload hands
    // React a fresh object, and an effect re-run (which Next.js can trigger while
    // navigating) turns into an endless render loop.
    const update = (p: Profile | null) => {
      if (active) setProfile((prev) => (sameProfile(prev, p) ? prev : p));
    };
    backend
      .getProfile()
      .catch(() => null)
      .then((p) => {
        update(p);
        if (active) setReady(true);
      });
    const unsubscribe = backend.onAuthChange(update);
    return () => {
      active = false;
      unsubscribe();
    };
  });

  return <AppContext value={{ backend, profile, ready }}>{children}</AppContext>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
