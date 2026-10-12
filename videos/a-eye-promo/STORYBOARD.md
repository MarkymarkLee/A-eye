---
format: 1920x1080
duration: 30s
message: "Eyes on the ground for AI agents — agents ask about a real place, people nearby answer with a verified live photo and get paid in AUSD"
arc: Demo Loop — hook → product intro → demo cycle (ask → answer → result) → proof → CTA
audience: hackathon judges and developers building AI agents
mode: autonomous
music: upbeat driving electronic tech promo, punchy drums, confident and bright, 120 bpm
captions: skipped (no narration; on-screen kinetic type carries the story)
---

## Video direction

- **Palette (frame.md roles):** two worlds. *Ink world* `black #15130F` field with `cream #F7F6F3` type for the hook and proof beats; *product world* `cream #F7F6F3` field with `black` type for the demo loop. `coral #FF5B1F` is the one accent: prize pills, checks, the active word. The app's orange→pink gradient (`coral → pink #FF3D6E`) may color ONE emphasis word per frame (as in the app's "win the prize."). The F2 brand sting is a full `coral` field. `ok #157347` only on the green "agree/success" chips. Diagonal hatch (frame.md component) at 6% ink inside coral regions only.
- **Type:** display = Geist 700 sentence case, tight tracking (frame.md hero-title / section-headline / jumbo-feature); labels = Geist 700 uppercase tracked (section-label); all code/tx/terminal text = Geist Mono. Step labels "1 · Agent asks", "2 · People nearby answer", "3 · Agent gets the truth" sit top-left as section-labels in coral.
- **Motion grammar:** fast promo, ~120 bpm feel. Long-tail power3 eases, quick (0.35–0.6s) entrances; hard cuts for word swaps; one spring-pop allowed per frame for the payoff element. Reveal each piece on its on-screen cue (the `voiceover` line here = the on-screen copy cue order, not narration); never front-load. Holds: subtle jitter at most.
- **Rhythm / holds:** F2 (brand sting) resolves and holds still ~1s; F6 receipt holds still ~1.2s before the CTA; F7 holds the finished end card ~2s. All other frames reveal continuously.
- **Phones:** app screens appear inside a clean rounded phone frame (ink bezel, large radius, soft drop shadow) — the only rounded/shadowed element allowed against frame.md's zero-radius rule, because it is a device.
- **Negative list:** no purple/blue "AI" gradients, no bokeh, no stock photos, no fake logos, no browser chrome or cursor, no real-money language (always "test money"/testnet where money appears); no slideshow (front-load then freeze) and no screensaver (everything floating independently).

## Frame 1 — They can't see

- scene: On an ink field, "Your AI agent can search the whole web." then "But can it see ___ right now?" with the slot cycling real questions
- voiceover: "Your AI agent can search the whole web. — But can it see — the coffee line? / if it's open? / the crowd? — right now?"
- duration: 4s
- transition_in: cut
- status: animated
- src: compositions/frames/01-hook.html
- type: hook
- persuasion: Negative contrast
- beat: curiosity + tension
- blueprint: kinetic-type-beats (Adapt — fixed-line word swap)
- asset_candidates:
- focal: the cycling slot word
- roles: typography only
- sfx: tick (on each slot swap), whoosh-short (into "right now?")

narrativeRole: names the gap agents have — they can't see the physical world in real time.
keyMessage: agents are blind to "right now."

Adapt: keep the in-place token swap signature; two lines instead of one, the swap lives in line 2.
Scene 1 (0.0–1.2s): ink field. "Your AI agent can search the whole web." rises in word-by-word, centered, cream, section-headline scale, ~70% width. Holds briefly.
Scene 2 (1.2–1.5s): line 1 hard-cuts out; "But can it see" lands centered-left in cream at hero-title scale, an empty slot to its right.
Scene 3 (1.5–2.9s): the slot hard-cut-swaps three real questions in coral, ~0.45s each: "the coffee line?" → "if it's open?" → "the crowd?" — each swap with a tiny vertical snap. Fixed words never move.
Scene 4 (2.9–4.0s): the slot clears and "right now?" punches in at jumbo scale beneath, orange→pink gradient, spring-pop; a thin coral underline draws under it. Holds.

## Frame 2 — A-eye

- scene: The A-eye eye mark spring-blooms on a coral field, wordmark slides out, tagline "Eyes on the ground for AI agents."
- voiceover: "A-eye. — Eyes on the ground for AI agents."
- duration: 3s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/02-brand.html
- type: product_intro
- persuasion: Category creation
- beat: clarity + intrigue
- blueprint: logo-assemble-lockup (Adapt — text-clears-mark-blooms-lockup)
- asset_candidates: assets/logo-0fcf4929.svg — the real A-eye eye mark: iris ring gradient, pupil, highlight dot — inline the SVG and define the CSS vars accent, accent-2 and bg
- focal: assets/logo-0fcf4929.svg
- roles: logo-0fcf4929 = cutout
- sfx: impact-soft (on the bloom)

narrativeRole: lands the value claim in beat 2 — what A-eye is.
keyMessage: A-eye gives AI agents eyes on the ground.

Adapt: keep the mark-blooms-from-zero signature; field is coral (not warm flat), and the mark's iris is recolored ink/cream so it reads on coral.
Scene 1 (0.0–0.8s): coral field with 45° hatch. The eye mark spring-blooms from zero dead-center, large (~22% of frame height); the iris ring draws on as a stroke sweep while it scales; the pupil drops in last and the highlight dot blinks once.
Scene 2 (0.8–1.6s): the mark slides left as the "A-eye" wordmark reveals to its right (ink, jumbo-feature scale) via a left-to-right mask wipe; balanced lockup centered.
Scene 3 (1.6–3.0s): "Eyes on the ground for AI agents." rises in beneath the lockup (ink, column-title scale), word-stagger. Lockup holds still (allocated stillness).

## Frame 3 — Agent asks

- scene: A terminal/MCP card on cream types the agent's ask_location_question call, then the x402 payment settles with checkmarks
- voiceover: "1 · Agent asks — "Is there a line at the coffee cart?" — 150 m · 10 min · 0.10 AUSD — paid over x402 · no gas ✓"
- duration: 4.5s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/03-ask.html
- type: feature_showcase
- persuasion: Show-don't-tell proof
- beat: curiosity → control
- blueprint: prompt-type-submit-generate (Adapt — terminal skin, one round trip)
- asset_candidates:
- focal: the terminal card with the typed tool call
- roles: terminal card = hero (reconstructed UI, Geist Mono)
- sfx: typing (under the prompt), click-soft (submit), success-chime (payment check)

narrativeRole: demo cycle 1 — the agent posts a paid question about a real place.
keyMessage: any agent can ask, over MCP, and pay instantly.

Adapt: keep the char-by-char typing into a real input + machine-answers signature; the "answer" is the payment receipt rows, not generated text.
Scene 1 (0.0–0.5s): cream field. Coral section-label "1 · AGENT ASKS" top-left. A white terminal card (ink title bar with three dots and the label "a-eye MCP", Geist Mono) slides up into the left-center, ~60% width, asymmetric 60/40.
Scene 2 (0.5–2.4s): inside the card the call types character-by-character behind a coral caret:
  `ask_location_question({`
  `  question: "Is there a line at the coffee cart?",`
  `  radius_m: 150, minutes: 10, prize: "0.10 AUSD"`
  `})` — question string in coral.
Scene 3 (2.4–3.6s): submit flash on the card; response rows cascade in beneath, each with a check that flips coral: "402 Payment Required" (muted) → "Signed ERC-3009 authorization" → "Paid 0.10 AUSD · Base Sepolia · no gas" — ok-green check on the last.
Scene 4 (3.6–4.5s): in the right 40% a big map-pin glyph (coral, the app's pin) drops in with a radius ring pulsing once outward, label "Question live · 150 m" beneath. Holds.

## Frame 4 — People nearby answer

- scene: The real A-eye phone app shows the prize pin on the campus map; a shutter flash snaps a photo; three verification checks tick in beside the phone
- voiceover: "2 · People nearby answer — Walk to the pin. Snap a live photo. — GPS within 75 m ✓ — Shot in-app, under 2 min ✓ — Unique photo (SHA-256) ✓"
- duration: 5s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-answer.html
- type: feature_showcase
- persuasion: Friction reduction + trust by verification
- beat: ease → confidence
- blueprint: device-surface-showcase (Adapt — stepwise-flow, cursorless)
- asset_candidates: assets/app-home.png — phone screen, campus map with orange prize pin and "Answer a question, win the prize." sheet
- focal: assets/app-home.png
- roles: app-home = hero inside phone frame
- sfx: shutter (on the flash), tick (each check)
- handoff_out: phone frame — center x 560px, center y 500px, height 860px (screen 780×1688 scaled to fit), scale 1, opacity 1, rotation 0, static at the cut

narrativeRole: demo cycle 2 — humans on the spot answer with proof.
keyMessage: anyone nearby can answer in ~20 seconds, and every answer is verified.

Adapt: keep the held device surface advancing through a real flow; the "screen advance" is a shutter flash + an answer chip instead of a second screenshot, and verification checks build beside it.
Scene 1 (0.0–0.8s): cream field. Coral section-label "2 · PEOPLE NEARBY ANSWER" top-left. The phone (app-home.png inside the frame) coasts up into the left-third (center x≈560) from below on power3 and settles; the map's prize pin label shows "0.10 AUSD" (overlay a coral pill over the screenshot's pin label at its measured position, ≈ x 14–187, y 457–519 in the 780×1688 screen, scaled) and pulses once.
Scene 2 (0.8–1.8s): right side: "Walk to the pin." then "Snap a live photo." rise in (ink, section-headline scale, the word "live" in orange→pink). At 1.5s a white shutter flash blinks over the phone screen and a small photo thumbnail chip (a neutral coffee-cart-colored placeholder card labeled "photo · 12:04") pops onto the phone's lower half with answer chip "No line" in coral.
Scene 3 (1.8–4.0s): three verification rows cascade in on the right under the headline, ~0.6s apart, each a white sidebar-item with coral left border and a coral check that flips on: "GPS within 75 m", "Shot in-app, under 2 minutes", "Unique photo · SHA-256".
Scene 4 (4.0–5.0s): everything resolved; holds. Phone stays exactly at handoff position for the cut.

## Frame 5 — Agent gets the truth

- scene: The same phone swaps to the results screen; "No line. 100%." lands big with "The internet guessed / People there proved" side by side
- voiceover: "3 · Agent gets the truth — No line. 100% — The internet guessed. People there proved it."
- duration: 4.5s
- transition_in: cut
- status: animated
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

## Frame 6 — Paid. On chain.

- scene: On ink, a Base Sepolia receipt card — winner payout in AUSD with the real tx hash typing in — under "Winner paid in AUSD."
- voiceover: "Winner paid in AUSD. — 0x88f3a82b…cdaf86376 · Success ✓ — Provably fair draw · 90% of the pot · refunds if unanswered"
- duration: 4s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/06-proof.html
- type: social_proof
- persuasion: Verifiable proof
- beat: skepticism → trust
- blueprint: titlecard-reveal (Adapt — single proof card, one move, then hold)
- asset_candidates:
- focal: the receipt card with the tx hash
- roles: receipt card = hero (reconstructed explorer row, Geist Mono)
- sfx: typing (hash), success-chime (Success check)

narrativeRole: "this is real" — the payout exists on chain.
keyMessage: real AUSD settlement on Base Sepolia, verifiable by anyone.

Adapt: keep one restrained reveal + still hold; a typed hash inside the card is the only internal motion.
Scene 1 (0.0–0.8s): ink field. "Winner paid in AUSD." rises in, cream, section-headline scale, upper third centered; "AUSD" in orange→pink.
Scene 2 (0.8–2.4s): a receipt card slide-up-crossfades in below (white on ink, coral top border, ~55% width): header row "Base Sepolia · Transaction" + a small "TESTNET" pill; rows "Token  AUSD", "Method  transferWithAuthorization (gasless)", then the real hash types in Geist Mono, shortened as "Tx  0x88f3a82b…cdaf86376"; finally a green "Success ✓" chip spring-pops on the header row.
Scene 3 (2.4–4.0s): one line fades in under the card, cream at 70%: "Provably fair draw · 90% of the pot · refunds if unanswered". Hold still.

## Frame 7 — Give your agent eyes

- scene: End card on cream — "Give your agent eyes." demotes, a terminal pill types `npx -y a-eye-mcp`, URL and eye mark lock up
- voiceover: "Give your agent eyes. — npx -y a-eye-mcp — a-eye-1zsv.onrender.com"
- duration: 5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/07-cta.html
- type: cta
- persuasion: Friction reduction (one command)
- beat: motivation + urgency-to-act
- blueprint: prompt-type-submit-generate (Reproduce — install-command end card)
- asset_candidates: assets/logo-0fcf4929.svg — A-eye eye mark for the lockup
- focal: the terminal pill with the install command
- roles: logo-0fcf4929 = supporting (lockup mark)
- sfx: typing (command), impact-soft (final lockup)

narrativeRole: the one action — connect an agent.
keyMessage: one command or one URL and any agent can see the world.

Scene 1 (0.0–1.2s): cream field. "Give your agent eyes." lands centered at hero-title scale (ink; "eyes." in orange→pink), word-stagger.
Scene 2 (1.2–1.8s): the headline DEMOTES — shrinks to ~60%, lifts to the upper third. An ink terminal pill springs in center and stretches wide.
Scene 3 (1.8–3.0s): inside the pill `npx -y a-eye-mcp` types char-by-char in Geist Mono (cream text, coral "$" prompt), blinking coral caret.
Scene 4 (3.0–3.8s): beneath, the eye mark + "a-eye-1zsv.onrender.com" (Geist 600, ink) pop in as a small lockup; a muted line "MCP · x402 · AUSD · Base Sepolia testnet" fades in under it.
Scene 5 (3.8–5.0s): hold; only the caret blinks. Final exit: a gentle fade to cream in the last 0.3s.
