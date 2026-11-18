# Neon Bay

[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/YUSUFID2/neon-bay-gta6/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/YUSUFID2/neon-bay-gta6/reward.svg)](https://make.fun/bounty/gta6-01)

**Neon Bay** is a top-down 2D open-world crime game in the spirit of GTA 6
(GTA 1/2-style camera), built as an entry for the make.fun **"Make GTA 6"**
bounty (`gta6-01`). Everything is original: the city, the characters, the
vehicles, the story, the art, and the sound — nothing from Rockstar.

Jax Moreno comes home to Neon Bay broke and in debt to Rosa, the fixer who
runs the bay after dark. Six jobs stand between him and a clean slate. In
between, the city is yours: steal cars, dodge the law, grab taxi fares and
hidden packages, and cause chaos.

Entered on [make.fun](https://make.fun/?ref=k62ycwh7&utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

> Play it, then sign up with my referral link — https://make.fun/r/k62ycwh7
> (code: `k62ycwh7`) — and build your own game on make.fun.

## How to run

No build step, no install, no network requests. Just static files.

**Option 1 — open the file:**

```sh
open game/index.html   # or double-click it in your file manager
```

**Option 2 — serve it locally:**

```sh
node serve.ts
# then open http://localhost:8080
```

Desktop keyboard + mouse required. The game runs offline in any modern
desktop browser.

## Controls

| Input | Action |
| --- | --- |
| WASD / Arrow keys | Walk (Shift to sprint) |
| Mouse | Aim |
| Left click | Shoot |
| E | Enter / exit a car |
| F | Steal a car (pull the driver out, or hotwire a parked car) |
| R | Reload |
| Space | Handbrake while driving |
| 1 / 2 / Q | Switch weapon (pistol / shotgun / cycle) |
| Esc / P | Pause |
| M | Mute |

## Features

- **Neon Bay, a hand-seeded coastal city** — four districts (Downtown,
  Harborfront, Northside, Old Town), a harbor with a bridge, parks, docks,
  billboards, and neon. The same seed always builds the same city.
- **Six story missions** — a getaway drive, a pickup under police attention,
  a turf shootout, a boat-yard heist, a bridge chase, and a final showdown
  at the harbor. Each has objectives, a map marker, briefing dialogue, cash
  rewards, and a retry on failure.
- **Vehicles** — taxi, sedan, sports car, truck, and a drivable police
  cruiser, each with its own speed, handling, and toughness. Cars take
  damage, smoke, and explode. Stealing an occupied car raises your wanted
  level on the spot.
- **Wanted level 0–5** — police chase on foot and in cruisers, ram and try
  to box you in. Get surrounded by two or more police cars for three seconds
  while driving and you're busted. Wanted decays when you stay out of sight
  and out of trouble.
- **Combat** — mouse-aimed pistol and shotgun with muzzle flash, tracers,
  hit sparks, and screen shake; rival gang members with chase-and-shoot AI;
  health / armor / ammo pickups; slow health regen out of combat.
- **Living streets** — ambient traffic that follows lanes, stops for the car
  ahead, waits at intersections, and turns corners; pedestrians who walk the
  sidewalks, cross at crosswalks, and flee from gunfire and fast cars.
- **HUD, minimap, menus, save** — health/armor bars, wanted stars, cash,
  ammo, objective line, speedometer, and clock; a live minimap with streets,
  the player arrow, police blips, and the mission marker; title, pause, and
  busted/wasted screens; save/load through localStorage.
- **Synthesized sound** — every sound is made with WebAudio (engine hum,
  sirens, gunshots, pickups, mission stingers, a bass-and-hats music loop).
  No audio files.
- **Sharp HD rendering** — the canvas is sized to the viewport times the
  device pixel ratio (capped at 2), so the game stays crisp at 1920×1080,
  1280×720, and on HiDPI screens.

## Screenshot scenes

The game reads the page query string, so any scene can be opened directly:

- `game/index.html?shot=start&seed=1` — title screen over the city
- `game/index.html?shot=play&seed=1` — mid-chase in a busy street, police
  behind, mission objective active
- `game/index.html?shot=end&seed=1` — mission-complete moment with cash earned

The `seed` parameter makes each scene deterministic.

## Tech

- Plain ES modules under `game/src/` — no libraries, no build step, no
  network requests. Every file the page loads lives under `game/`.
- All randomness comes from a seeded RNG (`game/src/random.js`); the same
  seed always builds the same city and the same traffic.
- Entry plumbing (`main.ts`, `serve.ts`, `shots.json`) follows the make.fun
  `gta6-01` starter; the game itself is original work.

## Repo

- GitHub repo name: **`neon-bay-gta6`** (owner: `YUSUFID2`)
- License: MIT — see [LICENSE](LICENSE).
