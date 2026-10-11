import { Crosshair, Eye, Flame, Trophy, type LucideIcon } from "lucide-react";
import { BADGES, type BadgeId } from "@/lib/reputation";

const ICONS: Record<BadgeId, LucideIcon> = {
  first_eyes: Eye,
  streak_3: Flame,
  raffle_winner: Trophy,
  sharpshooter: Crosshair,
};

const ORDER = Object.keys(BADGES) as BadgeId[];

/** Compact icon row for list rows. */
export function BadgeIcons({ badges }: { badges: BadgeId[] }) {
  if (badges.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {ORDER.filter((id) => badges.includes(id)).map((id) => {
        const I = ICONS[id];
        return (
          <span
            key={id}
            title={`${BADGES[id].label}: ${BADGES[id].description}`}
            className="grid size-6 place-items-center rounded-full bg-accent/12 text-accent-ink"
          >
            <I size={14} aria-hidden />
            <span className="sr-only">{BADGES[id].label}</span>
          </span>
        );
      })}
    </span>
  );
}

/** Every badge, earned ones lit, the rest showing how to get them. */
export function BadgeGrid({ badges }: { badges: BadgeId[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {ORDER.map((id) => {
        const I = ICONS[id];
        const earned = badges.includes(id);
        return (
          <li
            key={id}
            className={`flex items-start gap-3 rounded-[14px] p-3 ${
              earned ? "bg-surface ring-1 ring-line" : "border border-dashed border-line"
            }`}
          >
            <span
              className={`grid size-9 shrink-0 place-items-center rounded-full ${
                earned ? "bg-accent text-on-accent" : "bg-surface-2 text-muted"
              }`}
            >
              <I size={18} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className={`block text-[14px] font-medium leading-tight ${earned ? "" : "text-muted"}`}>
                {BADGES[id].label}
                <span className="sr-only">{earned ? " (earned)" : " (not earned yet)"}</span>
              </span>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{BADGES[id].description}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export const pct = (rate: number | null) => (rate === null ? "New" : `${Math.round(rate * 100)}%`);
