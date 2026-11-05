"use client";

import { CrashScreen } from "@/components/crash-screen";

/** Last resort when the app frame itself crashes: never a blank white page. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0, background: "#0B3B2E" }}>
        <CrashScreen error={error} retry={retry} />
      </body>
    </html>
  );
}
