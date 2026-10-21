import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Mentions légales · poinderecharge" };

export default function MentionsLegalesPage() {
  return <LegalPage doc="notice" />;
}
