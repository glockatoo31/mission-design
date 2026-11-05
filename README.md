# Mission Design

A 20-minute classroom demo for engineering freshmen. Teams of five share one phone, take a space
mission contract, build a spacecraft together as four leads, launch it, and learn from what breaks.
Static, client-only (Vite + vanilla JS). No backend, no accounts, no network calls after load.

## The game

Three rounds, about five minutes each.

1. **Contract.** Pick one of four missions, one per destination, all orbiters or flybys (Mars, Europa, Mercury, Pluto). Each fixes the
   instrument, the science goal, the deadline and the funding.
2. **Requirements.** The contract becomes four plain requirements (R1 get there, R2 do the science,
   R3 stay alive, R4 afford it and launch it), each with an owner and its own gauge.
3. **Six subsystem pages**, one per subsystem, passing the phone between four leads. The spacecraft starts
   as a flying baseline. Each page has its own **mini-challenge**: meet that subsystem's requirement with
   the least of its own cost.
   - **Communications** (Comms Lead): *Close the link*, with the least power draw.
   - **Trajectory** (Propulsion & Trajectory Lead): *Make the window*, with the smallest burn.
   - **Propulsion** (same lead): *Make the burn*, with the lightest engine and tank.
   - **Thermal** (Power & Thermal Lead): *Stay in range*, with the least mass.
   - **Power** (same lead): *Keep the lights on*, with the least mass.
   - **Rocket** (Flight Director): *Lift it*, with the cheapest rocket.

   Every subsystem offers several **real parts**, each with its own character and a **heritage** (flight-proven,
   qualified, or new): four antennas (X-band patch, X-band dish, deployable mesh, Ka-band), five power sources
   (silicon, GaAs and ROSA-style arrays, an MMRTG, a GPHS-RTG), five thermal systems (MLI, louvers + radiators,
   heat pipes, a tantalum box, a Juno-style titanium vault), five engines (hydrazine, a solid motor, an
   R-4D-class biprop, a Hall thruster, a Dawn-style ion thruster), two tank types and four launchers. After
   choosing a part you **size it** with sliders (dish and transmitter power, array area or RTG count, battery,
   radiator and shielding, fuel).

   **Heritage matters.** How much heavier than planned the hardware comes out at launch depends on how proven
   each part is, weighted by its mass (5% for flight-proven, 12% qualified, 25% new), and launch day decides how
   much of it shows up. A cheap, new part has a hidden cost.

   Every part is also a small **trade study**: each option shows its numbers at its usual size on criteria that
   pull against each other, including its risk (the best per criterion is green), and the lead taps a part to pick it. From round 2 a page shows live, as you drag the sliders, whether its challenge is
   **met and lean**, **met but over-built** (and which part and size would do it with less), **not met**, or
   **not met and nothing on the page can fix it** (another lead's choice is in the way).
4. **Review**, then **launch** (about 30 seconds, with a 2x button from round 2).
5. **Result**: up to three stars. ★ you arrived and operated, ★★ you met the science goal, ★★★ you did it
   within 10% of the par cost (the cheapest possible design). Going over budget fails R4 and caps the
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
- Every choice is a trade, and it is recorded. Review shows a decision record (what was chosen, why,
  whether it was the best on that reason, what it gave up), and a failure names the trade behind it.
  When the contract changes in round 2, every reason is cleared and the team re-confirms each trade.
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

Every part type is tried at several sizes: 192,000 designs per contract (576,000 where there is a dark period to
survive: Mars and Mercury, which also try three battery sizes). The test streams all of them through the same
`src/model.js` the app uses, for both the original and the amended contract (a few minutes), and checks that:

- every contract has winning designs and funding keeps the par cost 10-14% inside it; `src/par.js` (the stored cheapest designs) matches the solver
- no design has every bar green, and the best winner runs 5-14% thin
- the amended contract is still winnable at about 12% margin, and the amendment bites (the round-1 cheapest design stops winning, or the cheapest design costs 25% more)
- each contract has at least three reachable failure modes including its own hazard
- interface demands add up to the need (power, heat, lift, cost), and a failure traces to the interface in deficit
- every choice is a real trade (no option is best on every criterion), and the decision record works for sampled designs
- the cheapest winner meets all six subsystem mini-challenges, and each challenge can land in at least two outcomes
- every part is in at least one winning design somewhere (no dead weight), and no part is in every winner
- an over-budget design flies in round 1

All numbers live in [`src/data.js`](src/data.js) and [`src/parts.js`](src/parts.js) (including each contract's `change`). After changing any
number, regenerate the stored par designs and rerun the test:

```bash
npm run balance -- --write-par
npm run balance
```

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
| `?debug` | Shows "Random design" / "Cheapest full success" buttons on the subsystem pages and skips all timers. A full three-round game in about a minute. |
| `?demo` | The contract board shows only Mars Survey Orbiter, Europa Flyby Spectrometry and Mercury Orbiter (three different traps). Good for a 20-minute session. |

Combine them: `?seed=7&demo` (add `&debug` to rehearse).

## How the model works (short)

- **Parts are formulas.** Each preset sets sizes (array area, RTG units, dish and transmitter power, radiator
  area, shielding, fuel) and the formulas in `src/data.js` return mass, cost and performance.
- **Mass**: bus + instrument + parts, plus 25% structure; fuel on top. A hidden mass growth (seeded, scaled by how proven each part is) is applied at launch.
- **Launcher**: capacity falls with launch energy. Direct needs more energy than Assist.
- **Delta-v**: rocket equation from engine Isp and fuel. Every burn carries a trajectory-correction allowance (30 m/s plus 5%). Electric engines (Hall, ion) need power at arrival and extra delta-v to capture; a solid motor cannot be trimmed, so it needs 8% more.
- **Power**: solar falls with 1/r² and degrades each year (silicon twice as fast as GaAs); RTGs are constant but decay (an MMRTG 4%/yr, a GPHS-RTG 1.5%/yr). Load = bus + instrument + transmitter (3 W per radio watt) + heaters.
- **The dark**: Mars's and Mercury's eclipses run on the battery. It may be discharged to 80% at most, and cycle life falls steeply with depth of discharge (about 2,500 cycles at 40% depth, far fewer at 80%), so a battery that is too small runs flat and one that is cycled too deep wears out before the mission ends. An RTG keeps supplying through the dark.
- **Thermal**: sunlight (plus RTG and amplifier waste heat) against the radiator limit; the cold side shows up as heater power, and radiators leak heat in the cold.
- **Data**: returned = min(generated, downlinked); downlink falls with 1/r² from Earth.
- **Radiation**: dose from the trip, the destination, flybys and flares, against the shielding.
- **Cost**: parts + rocket + operations ($/year × mission years). Over budget fails R4.
- **Design life**: every part has one; longer missions can outlive parts.
- **Hazards**: Mercury 10x sun and eclipses, Mars dust storm (−90% sunlight) and eclipse cycling, Europa radiation, Pluto faint signal.

## Manual test checklist (multiple phones)

Open the URL on 3-4 phones (or tabs, at least one real phone):

- [ ] Contract board shows the contracts (3 with `?demo`); picking one and tapping Next shows four requirements.
- [ ] Six subsystem pages (Communications, Trajectory, Propulsion, Thermal, Power, Rocket), each with a titled mini-challenge, a "Pass phone →" lead badge and real part names; the baseline is preselected and the craft drawing highlights the page's part.
- [ ] Each part shows its options with 2-3 numbers, the best per number in green. Tapping a number picks the option and shows "for <criterion>"; "Review" stays disabled until all seven have a reason.
- [ ] Round 1: no gauges, "Round 1 flies blind", no Back button. Review lists the choices. Launch runs about 30 s.
- [ ] An over-budget round 1 shows the bailout banner, and the result is capped at one star with "R4 not met".
- [ ] A failing round names the requirement, the owner, and the biggest demands behind it.
- [ ] Round 2: the requirements screen shows a "Contract amendment" banner; each page now shows its challenge status (met and lean, over-built, not met), its own gauges and charts, and a Cost/Lift bar; the 2x button works on the launch.
- [ ] Choosing Twin RTG (or a large dish) shows a "Change notice" naming another lead.
- [ ] Review shows the decision record; round 2+ also shows system requirements, interface requirements and "All budget graphs", and over-budget designs cannot launch.
- [ ] Round 2 clears every reason and asks the team to re-confirm each trade. A failure's anomaly report includes "The trade behind it".
- [ ] Result shows stars, score, "Your Cost | Target Par Cost" and a team code; round 3 ends with "Mission debrief".
- [ ] **Seed test:** `?seed=5` on two phones, build the same design, launch: same outcome, event and team code.
- [ ] **Debug test:** `?debug` → "Cheapest full success" builds a winning design that flies to ★★★.
- [ ] Refresh mid-game keeps progress; refreshing a launched round shows its result without replaying.
- [ ] "Start over (new team)" on the contract board clears the rounds; the debrief's "New mission" restarts.

## Files

- `src/data.js`: destinations, contracts and their amendments, formulas, events. `src/parts.js`: the parts catalog (names, numbers, heritage). `src/par.js`: generated cheapest designs.
- `src/model.js`: physics, launch simulation, anomaly chains, the design space and par cost. No DOM; shared with the balance script.
- `src/syseng.js`: requirements and interface requirements (who asks what of whom).
- `src/trades.js`: the trade table for each choice (criteria, best option) and the decision record.
- `src/pages.js`: the six subsystem pages and their mini-challenges (met? lean?).
- `src/main.js`, `src/style.css`, `src/charts.js`, `src/craft.js`, `src/scene.js`, `src/coupling.js`: the screens.
- `scripts/balance.mjs`: the balance test.
