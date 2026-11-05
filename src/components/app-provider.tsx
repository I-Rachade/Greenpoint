"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getBackend, type Backend } from "@/lib/backend";
import { sameFeatures, UNKNOWN_FEATURES, type Features } from "@shared/features";
import type { Profile } from "@shared/types";
import { PushRegistrar } from "./push-registrar";

interface AppContextValue {
  backend: Backend;
  profile: Profile | null;
  /** False until the stored session has been checked. */
  ready: boolean;
  /** Modules switched on in the backoffice; all off until the server (or the last answer kept) says otherwise. */
  features: Features;
  /** False until the server or the last answer kept has told which modules are on. */
  featuresReady: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

const FEATURES_KEY = "poinderecharge-features";

function readFeatures(): Features | null {
  try {
    const raw = window.localStorage.getItem(FEATURES_KEY);
    return raw ? { ...UNKNOWN_FEATURES, ...(JSON.parse(raw) as Partial<Features>) } : null;
  } catch {
    return null;
  }
}

function keepFeatures(features: Features) {
  try {
    window.localStorage.setItem(FEATURES_KEY, JSON.stringify(features));
  } catch {}
}

/**
 * The signed-in profile as last seen, so the app opens straight on the right screen (and keeps
 * it when the phone comes back offline or on a slow network) while the server is asked again.
 * Same device storage as the session itself (src/lib/backend/cloudflare.ts).
 */
const PROFILE_KEY = "poinderecharge-profile";

function readProfile(): Profile | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

function keepProfile(profile: Profile | null) {
  try {
    if (profile) window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    else window.localStorage.removeItem(PROFILE_KEY);
  } catch {}
}

function sameProfile(a: Profile | null, b: Profile | null): boolean {
  return a === b || (!!a && !!b && a.id === b.id && a.role === b.role && a.phone === b.phone && a.email === b.email && a.fullName === b.fullName && a.driverStatus === b.driverStatus && (a.ownerOf ?? []).join() === (b.ownerOf ?? []).join());
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [backend] = useState(getBackend);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [features, setFeatures] = useState<Features>(UNKNOWN_FEATURES);
  const [featuresReady, setFeaturesReady] = useState(false);

  useEffect(() => {
    let active = true;
    // Keep the previous object when nothing changed. Otherwise every reload hands
    // React a fresh object, and an effect re-run (which Next.js can trigger while
    // navigating) turns into an endless render loop.
    const update = (p: Profile | null) => {
      if (!active) return;
      keepProfile(p);
      setProfile((prev) => (sameProfile(prev, p) ? prev : p));
    };
    // The profile kept from last time first: no wait on the network before the first screen.
    const kept = readProfile();
    if (kept) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfile(kept);
      setReady(true);
    }
    backend
      .getProfile()
      .then(update, () => {
        // Network trouble: keep the profile kept from last time (a session that ended is
        // reported through onAuthChange and clears it).
      })
      .finally(() => {
        if (active) setReady(true);
      });
    const unsubscribe = backend.onAuthChange(update);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [backend]);

  useEffect(() => {
    let active = true;
    const apply = (next: Features) => {
      if (!active) return;
      setFeatures((prev) => (sameFeatures(prev, next) ? prev : next));
      setFeaturesReady(true);
    };
    // The last answer first, so the app offline or still loading shows what it showed before.
    const kept = readFeatures();
    if (kept) apply(kept);
    const load = () =>
      backend
        .features()
        .then((next) => {
          keepFeatures(next);
          apply(next);
        })
        .catch(() => {
          // Offline without an earlier answer: keep the module hidden, but stop waiting.
          if (active) setFeaturesReady(true);
        });
    void load();
    const unsubscribe = backend.subscribe(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [backend]);

  return (
    <AppContext value={{ backend, profile, ready, features, featuresReady }}>
      {children}
      <PushRegistrar />
    </AppContext>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
