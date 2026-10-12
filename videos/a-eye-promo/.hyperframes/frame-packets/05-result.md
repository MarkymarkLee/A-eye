# Frame packet: 05-result

## Project inputs

- Project: /Users/mark/coding/hackathons/A-eye/videos/a-eye-promo
- Design tokens: /Users/mark/coding/hackathons/A-eye/videos/a-eye-promo/frame.md
- RULES_DIR: /Users/mark/.claude/plugins/cache/hyperframes/hyperframes/0.8.146/skills/hyperframes-animation/rules

## Assigned storyboard block

## Frame 5 — Agent gets the truth

- scene: The same phone swaps to the results screen; "No line. 100%." lands big with "The internet guessed / People there proved" side by side
- voiceover: "3 · Agent gets the truth — No line. 100% — The internet guessed. People there proved it."
- duration: 4.5s
- transition_in: cut
- status: outline
- src: compositions/frames/05-result.html
- type: benefit_highlight
- persuasion: Feature-to-benefit translation
- beat: clarity + relief
- blueprint: video-text-pivot (Adapt — the phone slides aside for the hero stat)
- asset_candidates: assets/app-q.png — phone screen, settled question "Is there a line at the coffee cart outside Chou Hall?" with No 100% tally, The internet vs People there
- focal: assets/app-q.png
- roles: app-q = hero inside phone frame
- sfx: whoosh-short (phone slide), impact-soft (stat lands)
- handoff_in: phone frame — center x 560px, center y 500px, height 860px, scale 1, opacity 1, rotation 0, static at the cut (screen content is app-q.png from the first frame)

narrativeRole: payoff of the loop — the agent receives a real answer with evidence.
keyMessage: agents get percentages plus photo proof, not a web guess.

Adapt: keep the slides-aside-to-hand-weight-to-a-stat signature (never cut away from the surface).
Scene 1 (0.0–0.6s): phone at the exact handoff position, now showing app-q.png. Coral section-label "3 · AGENT GETS THE TRUTH" top-left. The tally bar on the phone (No 100%) glints once (a light sweep across the orange→pink bar).
Scene 2 (0.6–2.0s): on the right, "No line." slams in (ink, jumbo-feature scale) then "100%" counts up 0→100 beside/below it in orange→pink gradient, Geist 700 tabular numerals.
Scene 3 (2.0–3.6s): two cards build under the stat, side by side: left white card "The internet" / "guessed" (muted, with a globe glyph), right card in coral-soft with coral top border "People there" / "proved it · photo evidence" (with a camera glyph). Left first, right 0.4s later with a small spring-pop.
Scene 4 (3.6–4.5s): holds; the phone stays put.

## Selected blueprint: video-text-pivot

# video-text-pivot — Video → Text Pivot

**intent**: A product video holds center and claims attention, then slides aside to hand its weight to a hero stat in the space it vacates, then both clear and kinetic text types into the center — accent words carrying the meaning the video used to carry — sealed by a gradient pill. The arc is "show → yield → pivot → stamp," and each handoff pairs an exit with a same-anchor entrance so two beats read, not four.

**roles served**

- Product_Intro (from `metric-video-text-pivot`): when the open is "see the feature" then "see the impact" and the `[product video]` must stay visible through the stat reveal — it slides, it doesn't cut.
- Key_Feature: a feature clip that yields to a frame-filling metric and a typographic impact line.

**duration**: 6–8s

**shot structure** (a `[bg]` canvas; one `[product video]` as a real muted `.mp4` clip, a hero stat, then kinetic text — each pair shares a screen anchor so the handoff reads as a weight-transfer)

- **Scene 1 (0.0–~1.6s) — the video shows.** The `[product video]` lands centered on a smooth scale-up and breathes (a small y-bob), claiming full attention. Camera static.
- **Scene 2 (~1.6–3.2s) — yield + stat (signature move).** The video SLIDES aside (x + scale down) **into the very space** the `[hero stat]` now fills as the stat pops in with 3D-depth type — one weight-transfer reading as a single event, not two. The stat breathes within this window.
- **Scene 3 (~3.2–5.0s) — pivot to text.** Both video and stat clear out and kinetic `[impact text]` TYPES into the vacated center, character by character; its `[accent words]` carry the meaning the video used to carry.
- **Scene 4 (~5.0–end) — stamp.** A gradient `[pill]` snaps shut around the closing line (`scaleX` 0→1), its glow halo resolving a beat behind so the silhouette reads before the bloom — sealing the statement as one graphic. Holds.

**motion vocabulary**: video scale-in + small breath; weight-transfer slide (video x + scale-down handing off to the stat at the same anchor); 3D-depth stat type; character-stream typing; gradient pill scaleX-snap; glow-halo bloom trailing the silhouette.

**rule mapping**

- video entrance (smooth) and the weight-transfer slide → `gsap-effects` (scale/opacity then x + scale on a long-tail `power3`); the video itself is a muted `<video class="clip">` direct child of the root
- hero stat's frame-filling 3D type → `3d-text-depth-layers` (static-depth variation — layers built at setup, no cascade fighting the entry)
- the same-anchor video-exit ↔ stat-entry handoff (if treated as a morph) → `scale-swap-transition` (shared center)
- character-by-character impact typing through segmented spans → `dynamic-content-sequencing` (clean character stream) or `discrete-text-sequence`
- pill `scaleX` snap + trailing glow halo → `gsap-effects` (scaleX) + `ambient-glow-bloom` (the halo, resolving a beat behind)
- video / stat breath within their windows → `sine-wave-loop` (low-amplitude register — subtle jitter, gated to each element's window, never a forever loop)

**camera modifier**: camera-static — all motion is element-space (the video translates), so the "pivot" is the elements moving, not a camera.
