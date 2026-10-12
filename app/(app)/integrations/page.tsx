import type { Metadata } from "next";
import { IntegrationsBoard } from "@/components/integrations/board";

export const metadata: Metadata = { title: "Integrations" };

export default function IntegrationsPage() {
  return <IntegrationsBoard />;
}
