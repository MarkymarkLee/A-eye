"use client";
import { useEffect, useState } from "react";
import { Download as DownloadSimple, X } from "lucide-react";

const DISMISSED_KEY = "aeye_install_dismissed";

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> };

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/** "Install A-eye" row: native prompt on Android/desktop, hint text on iOS Safari. */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISSED_KEY) === "1");
    if (isStandalone()) return;
    if (isIOS()) setShowIOSHint(true);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setShowIOSHint(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (dismissed || (!deferred && !showIOSHint)) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="mt-4 flex items-center gap-2 rounded-[16px] bg-surface px-3.5 py-3 ring-1 ring-line text-[13px] leading-snug text-muted">
      <DownloadSimple size={18} aria-hidden className="shrink-0" />
      {showIOSHint && !deferred ? (
        <span className="flex-1">Install: tap Share, then Add to Home Screen</span>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-ghost flex-1 justify-start px-2 py-1 text-[13px]"
            onClick={async () => {
              await deferred?.prompt();
              setDeferred(null);
            }}
          >
            Install A-eye
          </button>
        </>
      )}
      <button type="button" onClick={dismiss} aria-label="Dismiss install prompt" className="shrink-0 p-1 hover:text-ink">
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
