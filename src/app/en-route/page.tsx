import { Suspense } from "react";
import { EnRoute } from "@/components/en-route";
import { RequireLogin } from "@/components/require-login";

// The reservation id is in the query string (?id=…): the site is a static export.
export default function EnRoutePage() {
  return (
    <RequireLogin>
      <Suspense>
        <EnRoute />
      </Suspense>
    </RequireLogin>
  );
}
