// The short intro at the top of each design screen: one line of why, a couple of
// facts for the chosen contract. Kept deliberately small.
import { FLYBYS, ENGINES, PAYLOADS, CONTRACTS } from './data.js';
import { fmtYr } from './model.js';

const rawSun = (D) => 1 / (D.sunAU * D.sunAU);
const pct = (x) => (x >= 0.1 ? `${Math.round(x * 100)}%` : x >= 0.01 ? `${(x * 100).toFixed(1)}%` : `${(x * 100).toFixed(2)}%`);
const energy = (c3) => (c3 > 30 ? 'high' : c3 > 10 ? 'medium' : 'low');

export function consideration(slot, D, d) {
  const C = CONTRACTS.find((x) => x.id === d.contract);
  const f = BUILDERS[slot];
  const c = f(D, d, d.traj ? D.traj[d.traj] : null, C);
  c.here = c.here.filter(Boolean).map((h) => h.replace(/\.$/, ''));
  return c;
}

const BUILDERS = {
  power: (D) => ({
    title: `Power at ${D.name}`,
    why: 'Array output grows with area and fades with distance squared. RTGs work anywhere, but are heavy and warm.',
    here: [
      rawSun(D) > 1.2 ? `Sunlight is ${rawSun(D).toFixed(1)}x Earth's. Arrays use ${D.solarCap}x.`
        : D.sunAU === 1 ? 'Sunlight is the same as at Earth, until night.'
          : `Sunlight is ${pct(rawSun(D))} of Earth's.`,
      { moon: 'Lunar night: 14 days with no sun.', mars: 'A dust storm cuts sunlight by 80%.', mercury: 'Arrays wear out fast this close to the Sun.' }[D.id]
        || 'Heaters will use power too.',
    ],
  }),

  thermal: (D, d) => ({
    title: `Heat and radiation at ${D.name}`,
    why: 'Radiators shed heat. Shielding blocks radiation and insulates. Both add mass, and heaters cost power.',
    here: [
      {
        mercury: `The Sun is ${D.hotFlux}x Earth's.`,
        moon: 'Surface swings from +120 °C to −170 °C.',
        mars: 'Cold, but mild.',
        europa: `Jupiter's belts: ${D.opsDosePerYr} krad every year.`,
        pluto: 'About −230 °C. Heaters work hard.',
      }[D.id],
      D.traj.assist.flyby === 'venus' ? `Assist route passes Venus (${FLYBYS.venus.flux}x sun).`
        : D.traj.assist.flyby === 'jupiter' ? `Assist route passes Jupiter (+${FLYBYS.jupiter.dose} krad).` : null,
      d.rtgUnits > 0 ? 'Your RTGs add waste heat: warm in the cold, bad in the heat.' : null,
    ],
  }),

  comms: (D, d, tr, C) => {
    const pay = C ? PAYLOADS.find((x) => x.id === C.payload) : null;
    return {
      title: `Talking to Earth from ${D.name}`,
      why: 'Science only counts once it reaches Earth. Data rate grows with dish area and transmitter power, and fades with distance squared.',
      here: [
        `${D.name} is ${D.earthAU} AU from Earth.`,
        pay ? `Your ${pay.name.toLowerCase()} makes ${pay.genGb} Gbit per year. Goal: ${C.goalGb} Gbit.` : null,
      ],
    };
  },

  traj: (D, d, tr, C) => ({
    title: `Route to ${D.name}`,
    why: 'Direct needs a big rocket. Assist borrows speed from planets: smaller rocket, longer trip.',
    here: [
      `Direct: ${fmtYr(D.traj.direct.cruise)} trip. Assist: ${fmtYr(D.traj.assist.cruise)} trip.`,
      C ? `Contract deadline: arrive within ${fmtYr(C.deadline)}.` : null,
      `Every year costs $${D.opsCostPerYr}M in operations.`,
    ],
  }),

  engine: (D, d, tr) => ({
    title: `Engine for ${D.name}`,
    why: 'Arrival needs a burn. Ion engines are efficient but gentle, and need power.',
    here: [
      tr ? `Burn: ${tr.dv} m/s, after ${fmtYr(tr.cruise)} of cruise.` : null,
      D.lowThrustPenalty >= 10 ? 'Ion cannot land on the Moon.' : D.lowThrustPenalty > 1 ? `Ion needs ${D.lowThrustPenalty}x more delta-v here.` : null,
      `Ion needs ${ENGINES.find((e) => e.lowThrust).powerW} W to run.`,
    ],
  }),

  tank: (D, d, tr) => ({
    title: 'Fuel',
    why: 'More fuel means more speed change, but fuel is mass the rocket must lift.',
    here: [tr ? `Burn needed: ${tr.dv} m/s.` : null, 'The heavier the spacecraft, the more fuel the same burn takes.'],
  }),

  launcher: (D, d, tr) => ({
    title: 'Rocket',
    why: 'Bigger rockets lift more but cost more. Your route sets how much they can lift.',
    here: [tr ? `Your route needs ${energy(tr.c3)} launch energy.` : null, 'Real hardware comes out heavier than planned.'],
  }),
};
