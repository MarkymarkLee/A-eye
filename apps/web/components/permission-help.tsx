"use client";
import { RotateCcw } from "lucide-react";
import { Button } from "./ui/button";

/** Friendly recovery steps when the browser blocked camera or location. */
export function PermissionHelp({ what, onRetry }: { what: "camera" | "location"; onRetry?: () => void }) {
  const ios = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const label = what === "camera" ? "Camera" : "Location";
  return (
    <div className="rounded-[16px] bg-surface-2 p-4 text-left text-[14px] leading-relaxed">
      <p className="font-semibold">Turn {what} back on</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
        {ios ? (
          <>
            <li>Tap <b className="text-ink">aA</b> in the address bar, then <b className="text-ink">Website Settings</b>.</li>
            <li>Set <b className="text-ink">{label}</b> to <b className="text-ink">Allow</b>.</li>
          </>
        ) : (
          <>
            <li>Tap the <b className="text-ink">lock or settings icon</b> next to the web address.</li>
            <li>Find <b className="text-ink">{label}</b> and choose <b className="text-ink">Allow</b>.</li>
          </>
        )}
        <li>Come back here and tap try again.</li>
      </ol>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          <RotateCcw className="size-4" aria-hidden /> Try again
        </Button>
      )}
    </div>
  );
}
