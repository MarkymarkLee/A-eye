"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-[560px] px-4 py-16">
      <EmptyState
        icon={<Compass className="size-7" aria-hidden />}
        title="Something went wrong"
        body="A-eye hit a snag loading this page. Try again in a moment."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={reset}>Try again</Button>
            <Button asChild variant="ghost">
              <Link href="/">Back to A-eye</Link>
            </Button>
          </div>
        }
      />
    </main>
  );
}
