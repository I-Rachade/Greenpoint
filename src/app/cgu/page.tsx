import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Conditions générales d'utilisation · poinderecharge" };

export default function CguPage() {
  return <LegalPage doc="terms" />;
}
