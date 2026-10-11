import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-[560px] px-4 py-16">
      <EmptyState
        icon={<Compass className="size-7" aria-hidden />}
        title="That question isn’t here"
        body="It may have been removed, or the link is wrong."
        action={
          <Button asChild>
            <Link href="/">Back to nearby questions</Link>
          </Button>
        }
      />
    </main>
  );
}
