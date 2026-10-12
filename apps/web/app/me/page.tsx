import type { Metadata } from "next";
import { MeView } from "@/components/me-view";
import { Page } from "@/components/motion/page";

export const metadata: Metadata = { title: "Me" };

export default function MePage() {
  return (
    <Page>
      <MeView />
    </Page>
  );
}
