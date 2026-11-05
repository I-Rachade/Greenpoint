import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Politique de confidentialité · poinderecharge" };

export default function ConfidentialitePage() {
  return <LegalPage doc="privacy" />;
}
