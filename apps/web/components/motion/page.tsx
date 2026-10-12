import { ViewTransition } from "react";

/**
 * Route-level transition. Links tagged `transitionTypes={["nav-forward"]}` slide in from the right,
 * `["nav-back"]` from the left; anything else crossfades. Wrap each page's root in this.
 */
export function Page({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition
      enter={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "fade" }}
      exit={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "fade" }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}

/** Shared element that morphs between routes when both sides use the same `name`. */
export function Morph({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <ViewTransition name={name} share="morph" default="none">
      {children}
    </ViewTransition>
  );
}
