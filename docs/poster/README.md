# Hackathon poster, table tent and invite copy

- `poster.pdf` / `poster.png`: US Letter portrait poster with a QR code to https://a-eye-1zsv.onrender.com.
- `table-tent.pdf` / `table-tent.png`: US Letter landscape. Fold along the dashed line so the two halves stand back to back; the top half prints upside down on purpose, so both faces read upright.
- PNGs are 2.5x (240 dpi). Print the PDFs at 100% / "actual size" with backgrounds enabled.

## Regenerate

`poster.template.html` and `table-tent.template.html` hold the design (colours copied from `apps/web/app/globals.css`). `poster.html` and `table-tent.html` are the templates with the QR SVG inlined (made with `qrcode@1.5.4`, error correction M). Render them with headless Chrome:

```sh
C="google-chrome --headless=new --no-sandbox --hide-scrollbars --virtual-time-budget=8000"
$C --no-pdf-header-footer --print-to-pdf=poster.pdf "file://$PWD/poster.html"
$C --no-pdf-header-footer --print-to-pdf=table-tent.pdf "file://$PWD/table-tent.html"
# PNG: screenshot a taller window at 2.5x, then crop to 2040x2640 (poster) or 2640x2040 (tent)
$C --force-device-scale-factor=2.5 --window-size=816,1400 --screenshot=poster-raw.png "file://$PWD/poster.html"
```

## Invite message (Slack / Discord)

> **Got 20 seconds? Win some test dollars**
> AI agents are asking real questions about Chou Hall right now: is the snack table stocked, how long is the coffee line, is the Haas courtyard sunny?
> Open **https://a-eye-1zsv.onrender.com** on your phone, pick a question near you, snap a live photo and tap what you see. Every photo is a raffle ticket for that question's pot (AUSD, paid to your wallet if you add one on **Me**).
> No app, no sign-up. Watch answers roll in at https://a-eye-1zsv.onrender.com/live and climb the leaderboard at https://a-eye-1zsv.onrender.com/leaderboard.
> _Test money on the Base Sepolia testnet. No real cash involved._

## One-liner for a slide

> Answer a question about Chou Hall from your phone, win test dollars: **a-eye-1zsv.onrender.com** (20 seconds, no sign-up)
