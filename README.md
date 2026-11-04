# Mission Design

A 20-minute classroom demo for engineering freshmen. Teams of 5 share one phone, design a
space mission, launch it, and usually fail the first time. The anomaly report traces the
failure back through the coupling chain to the team's own choices. Round 2 is a 3-5 minute
redesign.

Static, client-only (Vite + vanilla JS). No backend, no accounts, no network calls after load.

## Run locally

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` serves on your LAN too (`--host`), so phones on the same Wi-Fi can open
`http://<your-laptop-ip>:5173`.

## Balance test

```bash
npm run balance
```

This enumerates every design (3^7 part combos × 2 trajectories = 4,374 per destination, 21,870 total)
through the same `src/model.js` the app uses. It prints, per destination:

- full / minimum / any success rate (nominal launch: 7.5% mass growth, no random event)
- first-failure mode counts
- how often each constraint passes on its own (useful when tuning)
- which options appear in successful designs, and Direct vs Assist counts
- the cheapest full-success design
- average number of part changes from a failed design to the nearest full success (proxy for "round 2 takes 3-5 minutes")

and then a PASS/FAIL list against the tuning targets. Add `--seeds` to also average success over
seeds 1-20 (real launch conditions).

All numbers live in [`src/data.js`](src/data.js). Change them, rerun `npm run balance`, repeat.

Current results (all checks pass):

| Destination | Multiplier | Full success | Failure modes | Direct / Assist successes |
|---|---|---|---|---|
| Mercury | ×2.5 | 6.2% | 8 | 160 / 111 |
| Moon | ×1.3 | 5.6% | 5 | 111 / 135 |
| Mars | ×1.0 | 9.6% | 7 | 199 / 223 |
| Europa | ×1.8 | 5.6% | 7 | 118 / 128 |
| Pluto | ×2.5 | 5.8% | 7 | 142 / 112 |

Notes on what is forced (on purpose): Mercury needs radiators; Pluto needs an RTG. No option
appears in every successful design across all destinations.

## Deploy to GitHub Pages

The Vite config uses a relative base (`base: './'`), so the build works under any repo path.

**Option A: GitHub Actions (recommended)**

1. Push this folder to a GitHub repo.
2. In the repo: Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. The included workflow `.github/workflows/deploy.yml` builds and deploys on every push to `main`.
4. Your URL is `https://<user>.github.io/<repo>/`.

**Option B: manual**

```bash
npm run build
```

Then publish the `dist/` folder (for example push it to a `gh-pages` branch and set
Pages → Source → Deploy from branch → `gh-pages` / root).

Make a QR code of the URL (add `?seed=N` so every team gets the same launch conditions) and put it on a slide.

## URL flags

| Flag | Effect |
|---|---|
| `?seed=N` | Fixed randomness. Every phone with the same seed gets the same hidden mass growth and the same random event for each attempt number. Without it, each phone picks its own seed. |
| `?debug` | Shows "Random design" / "Cheapest full success" buttons on the build screens, auto-picks a random design when you leave screen 1, and skips all timers. Full flow in ~30 seconds. |

Combine them: `?seed=7&debug`.

## How the model works (short)

- **Mass**: payload + power + thermal + antenna + engine + tank + bus, plus 25% structure; propellant on top. A hidden 0-15% mass growth (seeded) is applied at launch and never shown before it.
- **Launcher**: capacity falls with launch energy (C3). Direct needs more energy than Assist.
- **Delta-v**: rocket equation from engine Isp and tank size. The ion engine needs 600 W at arrival and extra delta-v (low thrust); it cannot land on the Moon.
- **Power**: solar falls with 1/r² and degrades each year (faster near Mercury and Jupiter); RTG is constant but decays 1.5%/yr. Load = bus + payload + antenna + heaters.
- **Thermal**: hot side checks sunlight vs the radiator limit (RTG adds heat); cold side shows up as heater power (RTG waste heat offsets it).
- **Data**: returned = min(generated, downlinked); downlink falls with 1/r² from Earth.
- **Radiation**: dose from cruise, destination, Jupiter flyby, and solar flare event vs the protection option's tolerance.
- **Cost**: parts + launcher + ops ($/yr × mission years). Over budget blocks launch at review.
- **Duration**: every part has a design life. Longer (Assist) missions can outlive parts.
- **Unique hazards**: Mercury 10x sun (overheat), Moon 14-day night (battery), Mars dust storm (solar -80%), Europa radiation, Pluto faint signal (downlink).

Outcome: **No mission** / **Minimum success** (arrived and operated) / **Full success** (survived and hit the data goal).
Score = science points (100 = data goal, capped at 150) × destination multiplier.

## Manual test checklist (multiple phones)

Before class, on 3-4 phones (or 3-4 browser tabs, at least one on a real phone):

- [ ] Open the URL (via QR code) on every phone. Screen 1 shows 5 destinations with multiplier, hazard, minimum and full goals.
- [ ] Tap targets are easy to hit; nothing is cut off at phone width; the live strip stays pinned on screens 2-4.
- [ ] On screens 2-4, every tap updates the strip and shows +/− badges (e.g. pick the Hi-res imager: Mass goes up, Power goes down, Cost goes up).
- [ ] A gauge turns red when a limit is broken (e.g. Europa + small solar → Power red).
- [ ] Screen 4 budget box shows parts + launcher + ops; going over budget shows a warning.
- [ ] Screen 5 review shows green/yellow/red rows including Design life and Flyby hazard; over-budget designs cannot launch.
- [ ] Launch runs ~30 s: liftoff, cruise year bar with event markers, arrival burn, operations. A failure stops the animation.
- [ ] Results show tier, score, cost and a team code; failures show an anomaly report with a cause chain and numbers.
- [ ] "Redesign" returns to screen 2 with all choices kept and "Attempt 2" in the header.
- [ ] **Seed test:** open `?seed=5` on two phones, build the identical design, launch: both get the same outcome, random event and team code. Open `?seed=6` on a third with the same design: the random event may differ.
- [ ] **Debug test:** open `?debug`, pick a destination, Next through to launch: parts are auto-picked and the launch result appears instantly. Try "Cheapest full success" to see a passing design.
- [ ] Refresh mid-build: choices are kept. Refresh after a launch: the result shows again without replaying.
- [ ] "Start over (new team)" on screen 1 clears attempts for the next group.

## Files

- `src/data.js`: every tunable number (destinations, parts, launchers, events).
- `src/model.js`: physics, launch simulation, anomaly chains. No DOM; shared with the balance script.
- `src/main.js`, `src/style.css`: the six screens.
- `scripts/balance.mjs`: the balance test.
