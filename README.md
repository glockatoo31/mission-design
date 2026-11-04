# Mission Design

A 20-minute classroom demo for engineering freshmen. Teams of five share one phone, take a space
mission contract, build a spacecraft together as four leads, launch it, and learn from what breaks.
Static, client-only (Vite + vanilla JS). No backend, no accounts, no network calls after load.

## The game

Three rounds, about five minutes each.

1. **Contract.** Pick one of eight missions (Moon, Mars, Mercury, Europa, Pluto). Each fixes the
   instrument, the science goal, the deadline and the funding.
2. **Requirements.** The contract becomes seven numbered requirements (R1 data, R2 schedule, R3 funding,
   R4 the destination's hazard, R5 lift, R6 arrival burn, R7 stay powered/cool/alive), each with an owner.
3. **Build** on one board. The spacecraft starts as a flying baseline. Four leads take the phone in turn
   and choose a size for their part: **Comms** (antenna), **Propulsion & Trajectory** (route, engine,
   fuel), **Power & Thermal** (thermal, power), **Flight Director** (rocket). Every choice is a few
   chunky options, not a slider.
4. **Review**, then **launch** (about 30 seconds, with a 2x button from round 2).
5. **Result**: up to three stars. ★ you arrived and operated, ★★ you met the science goal, ★★★ you did it
   within 10% of the par cost (the cheapest possible design). Going over budget fails R3 and caps the
   round at one star.

**Round 1 is a blind flight test.** No gauges, no Back button; an over-budget design still flies (a
bailout). Most teams fail, and the anomaly report names the requirement that failed, its owner, and
which lead's demands caused it.

**Round 2: the contract changes.** The customer amends it (a better instrument, a bigger science goal,
more funding), so the round-1 design no longer fits. Gauges unlock: each lead sees only their own
(silos), cost and lift are shared, and the full dashboard waits for Review. When a choice hurts a budget
someone else owns, a **change notice** names that lead.

**Round 3: final attempt**, then a **debrief**: stars, best score, team code, and what the team practised.

### Systems engineering in it

- Requirements flow down: a choice by one lead puts requirements on another (a 40 W radio means Power
  must supply 120 W because the amplifier is 33% efficient, and Thermal must reject its heat). Each lead's
  "Who needs what" shows what is asked of them and what their choices ask of others.
- Margins are nominal. Launch adds 0-15% dry-mass growth and one anomaly, and funding is set so no design
  can have every margin green, so some margin is always a bet.
- Requirements change, and late choices break earlier leads' budgets.

## Run locally

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` serves on your LAN (`--host`), so phones on the same Wi-Fi can open `http://<your-laptop-ip>:5173`.

## Balance test

```bash
npm run balance
```

Every contract has 1,944 designs (4 antennas × 3 thermal × 4 power × 3 tanks × 3 engines × 2 routes × 3
rockets). The test plays all of them through the same `src/model.js` the app uses, for both the original
and the amended contract, and checks that:

- every contract has winners (7-49 each) and funding keeps the par cost 10-14% inside it
- no design has every bar green, and the best winner runs 5-14% thin
- the amended contract is still winnable at about 12% margin, and the round-1 cheapest design no longer wins
- each contract has at least three reachable failure modes including its own hazard
- interface demands add up to the need (power, heat, lift, cost), and a failure traces to the interface in deficit
- an over-budget design flies in round 1

Add `--seeds` to also average success over seeds 1-20. All numbers live in [`src/data.js`](src/data.js)
(including the preset sizes and each contract's `change`). Change them, rerun `npm run balance`, repeat.

## Deploy to GitHub Pages

The Vite config uses a relative base (`base: './'`), so the build works under any repo path.

**Option A: GitHub Actions (recommended)**

1. Push this folder to a GitHub repo.
2. In the repo: Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. The included workflow `.github/workflows/deploy.yml` runs the balance test, builds and deploys on every push to `main`.
4. Your URL is `https://<user>.github.io/<repo>/`.

**Option B: manual**

```bash
npm run build
```

Then publish the `dist/` folder (for example push it to a `gh-pages` branch and set Pages → Source →
Deploy from branch → `gh-pages` / root).

Make a QR code of the URL (add `?seed=N` so every team gets the same launch conditions) and put it on a slide.

## URL flags

| Flag | Effect |
|---|---|
| `?seed=N` | Fixed randomness. Every phone with the same seed gets the same hidden mass growth and random event for each round. Without it, each phone picks its own seed. |
| `?debug` | Shows "Random design" / "Cheapest full success" buttons on the build board and skips all timers. A full three-round game in about a minute. |
| `?demo` | The contract board shows only Lunar Pathfinder, Mars Survey Lander and Europa Flyby Spectrometry (three different traps). Good for a 20-minute session. |

Combine them: `?seed=7&demo` (add `&debug` to rehearse).

## How the model works (short)

- **Parts are formulas.** Each preset sets sizes (array area, RTG units, dish and transmitter power, radiator
  area, shielding, fuel) and the formulas in `src/data.js` return mass, cost and performance.
- **Mass**: bus + instrument + parts, plus 25% structure; fuel on top. A hidden 0-15% mass growth (seeded) is applied at launch.
- **Launcher**: capacity falls with launch energy. Direct needs more energy than Assist.
- **Delta-v**: rocket equation from engine Isp and fuel. The ion engine needs 600 W at arrival and extra delta-v.
- **Power**: solar falls with 1/r² and degrades each year; RTGs are constant but decay 1.5%/yr. Load = bus + instrument + transmitter (3 W per radio watt) + heaters.
- **Thermal**: sunlight (plus RTG and amplifier waste heat) against the radiator limit; the cold side shows up as heater power, and radiators leak heat in the cold.
- **Data**: returned = min(generated, downlinked); downlink falls with 1/r² from Earth.
- **Radiation**: dose from the trip, the destination, flybys and flares, against the shielding.
- **Cost**: parts + rocket + operations ($/year × mission years). Over budget fails R3.
- **Design life**: every part has one; longer missions can outlive parts.
- **Hazards**: Mercury 10x sun, Moon 14-day night, Mars dust storm, Europa radiation, Pluto faint signal.

## Manual test checklist (multiple phones)

Open the URL on 3-4 phones (or tabs, at least one real phone):

- [ ] Contract board shows the contracts (3 with `?demo`); picking one and tapping Next shows seven requirements.
- [ ] The build board shows four "Pass phone →" sections with chunky options; the craft drawing updates; the baseline is preselected.
- [ ] Round 1: no gauges, "Round 1 flies blind", no Back button. Review lists the choices. Launch runs about 30 s.
- [ ] An over-budget round 1 shows the bailout banner, and the result is capped at one star with "R3 not met".
- [ ] A failing round names the requirement, the owner, and the biggest demands behind it.
- [ ] Round 2: the requirements screen shows a "Contract amendment" banner; the build board now shows each lead's gauges and a Cost/Lift bar; the 2x button works on the launch.
- [ ] Choosing Twin RTG (or a large dish) shows a "Change notice" naming another lead.
- [ ] Review (round 2+) shows system requirements, interface requirements and "All budget graphs"; over-budget designs cannot launch.
- [ ] Result shows stars, score, "Your Cost | Target Par Cost" and a team code; round 3 ends with "Mission debrief".
- [ ] **Seed test:** `?seed=5` on two phones, build the same design, launch: same outcome, event and team code.
- [ ] **Debug test:** `?debug` → "Cheapest full success" builds a winning design that flies to ★★★.
- [ ] Refresh mid-game keeps progress; refreshing a launched round shows its result without replaying.
- [ ] "Start over (new team)" on the contract board clears the rounds; the debrief's "New mission" restarts.

## Files

- `src/data.js`: every tunable number (destinations, contracts and their amendments, part formulas, presets, launchers, events).
- `src/model.js`: physics, launch simulation, anomaly chains, the design space and par cost. No DOM; shared with the balance script.
- `src/syseng.js`: requirements and interface requirements (who asks what of whom).
- `src/main.js`, `src/style.css`, `src/charts.js`, `src/craft.js`, `src/scene.js`, `src/coupling.js`: the screens.
- `scripts/balance.mjs`: the balance test.
