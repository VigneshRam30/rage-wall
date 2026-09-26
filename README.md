# Rage Wall — live prototype

Punch a wall through your webcam until it breaks, then watch a slow-motion replay of your own face at the moment it went.

Static site: plain HTML/CSS/JS, no build step. Hand tracking is MediaPipe Hands, bundled locally in `vendor/hands/`, so there is no CDN dependency and video never leaves the browser.

## Run locally

The camera only works over `https://` or `http://localhost`. Opening `index.html` as a file will not work.

```
npx serve .          # or: python3 -m http.server 8000
```

Then open http://localhost:3000 (or :8000) in desktop Chrome.

## Deploy to Vercel

- **Dashboard:** New Project → import this folder or repo. Framework preset: **Other**. No build command. Output directory: `.`
- **CLI:** `npx vercel` in this folder, then `npx vercel --prod`

## Controls

- **Camera:** calibrate with both fists up. Hover a fist tone and hold it to pick, or punch to start. Punch toward the screen. Only closed fists count; you can change that in ⚙.
- **Mouse fallback:** click to punch. Holding the button longer hits harder. `Space` / `F` / `J` punch at the current arm positions, and `Shift` makes the punch heavy.
- **End screen:** `Enter` breaks another wall, `S` saves the frame, `R` rewatches the replay.
- **Tuning:** ⚙ → Show tracking debug, or `Alt + D`. This shows palm scale versus resting baseline, growth rate, fist state, and the thresholds.

## How punch detection works

A punch toward the camera makes your hand grow in the frame. For each hand the app:

1. Measures palm size: the perimeter of the wrist → index knuckle → pinky knuckle triangle.
2. Keeps a resting baseline from calibration. The baseline slowly follows you if you drift closer or further away.
3. Fires a punch when the palm grows faster than ~130%/s, is at least 8% bigger than the baseline, and the hand was a fist in the last 450 ms.
4. Picks the damage tier (light / medium / heavy) from the peak growth rate. The rate is never shown as a number, only as damage on the wall.
5. Still counts the punch if tracking drops out at full extension from motion blur.

The thresholds are `T0/T1/T2` in `updateTrack()` in `app.js`, scaled by the sensitivity setting.

## Files

- `app.js`: the whole game (state machine, tracking, punch detection, rendering, audio, replay recorder).
- `assets/`:
  - `wall.webp` — graffiti front wall.
  - `marks/` — 4 random decals per tier, built from your crack and brick photos.
  - `fx/` — cracks, chipped-brick openings, break hole, debris chunks, back wall.
  - `arms/` — painted 3D arm renders in 5 tones, plus the anchor and pivot data in `meta.json`.
  - `fists/` — tone swatches.
- `vendor/hands/`: MediaPipe Hands 0.4 (Apache-2.0).

3D sources: "Fists (2025)" by 1Matzh, "Colorful Graffiti on Concrete Wall" by ffedo, "Damaged Wall" by Philipp Busse, all CC BY 4.0.
