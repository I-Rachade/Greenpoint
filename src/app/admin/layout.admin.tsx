import type { ReactNode } from "react";
import { AdminShell } from "@/components/backoffice/admin-shell";
import { RequireLogin } from "@/components/require-login";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireLogin roles={["admin"]}>
      <AdminShell>{children}</AdminShell>
    </RequireLogin>
  );
}
