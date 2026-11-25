"use client";

import { CrashScreen } from "@/components/crash-screen";

/** A page that crashes shows a way back in place of a blank white screen. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  return <CrashScreen error={error} retry={retry} />;
}
