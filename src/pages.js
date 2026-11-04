// One page per subsystem, each with its own engineering mini-challenge:
//   meet this subsystem's requirement, with the least of its own cost.
// A challenge is checked live by trying every option on the page against the rest of the
// spacecraft as it stands. Pure functions; shared by the app and scripts/balance.mjs.
import { STEPS } from './data.js';
import { budgets, budgetMargins, ESTIMATE, fmtYr } from './model.js';

const min = (...ms) => { const n = ms.filter((m) => typeof m === 'number'); return n.length ? Math.min(...n) : null; };
const pct = (x) => (x >= 10 ? `${Math.round(x)}%` : x >= 1 ? `${x.toFixed(1)}%` : `${x.toFixed(2)}%`);
const HAZARD = {
  moon: 'the 14-day lunar night', mars: 'a global dust storm', mercury: '10x sunlight wearing the arrays out',
  europa: 'a long, dim cruise to Jupiter', pluto: 'a decade in near-darkness',
};

// pass: the margin that must be >= 0. minimize: what to keep as small as possible.
// rows: the interface rows (gauges) that belong to this page.
export const PAGES = [
  {
    key: 'comms', who: 'comms', title: 'Communications', name: 'Close the link', steps: ['comms'], craft: 'comms',
    charts: ['data'], rows: ['Data'],
    pass: (M) => M.data, minimize: { label: 'power draw', unit: 'W', value: (b) => b.P.comms.powerW },
    brief: ({ D, C }) => `Send ${C.goalGb} Gbit home from ${D.name}, ${D.earthAU} AU from Earth. Use as little power as you can.`,
    physics: () => 'A bigger dish and a stronger transmitter send more data. The amplifier is only 33% efficient: every radio watt draws 3 W and gives off heat.',
  },
  {
    key: 'traj', who: 'prop', title: 'Trajectory', name: 'Make the window', steps: ['traj'], craft: 'traj',
    charts: ['time'], rows: ['Schedule', 'Burn'],
    pass: (M) => M.time, minimize: { label: 'burn', unit: 'm/s', value: (b) => b.tr.dv },
    brief: ({ C }) => `Arrive within ${fmtYr(C.deadline)}. Take the route with the smallest burn that still gets there in time.`,
    physics: () => 'Direct is quick and needs a big rocket. A gravity assist borrows speed from a planet: a smaller rocket and burn, but a longer trip.',
  },
  {
    key: 'prop', who: 'prop', title: 'Propulsion', name: 'Make the burn', steps: ['engine', 'tank'], craft: 'engine',
    charts: ['dv'], rows: ['Burn', 'Ion burn power'],
    pass: (M) => M.dv, minimize: { label: 'propulsion mass', unit: 'kg', value: (b) => b.P.engine.mass + b.P.tank.mass + b.P.tank.prop },
    brief: ({ b }) => `Deliver the ${Math.round(b.tr.dv)} m/s arrival burn. Use the lightest engine and tank that do it.`,
    physics: () => 'Speed change follows the rocket equation: more fuel and a more efficient engine help, but every kilogram of fuel is mass you have to carry.',
  },
  {
    key: 'thermal', who: 'pt', title: 'Thermal', name: 'Stay in range', steps: ['thermal'], craft: 'thermal',
    charts: ['thermal', 'rad'], rows: ['Heat', 'Venus flyby', 'Radiation'],
    pass: (M) => min(M.thermal, M.rad), minimize: { label: 'mass', unit: 'kg', value: (b) => b.P.thermal.mass },
    brief: ({ D }) => `Keep the spacecraft inside its limits at ${D.name}: ${D.thermalLabel.toLowerCase()}, with ${D.opsDosePerYr} krad of radiation a year there. Use the lightest thermal system that does it.`,
    physics: () => 'Radiators shed heat, but they leak it in the cold. Shielding blocks radiation and insulates. Both are mass.',
  },
  {
    key: 'power', who: 'pt', title: 'Power', name: 'Keep the lights on', steps: ['power'], craft: 'power',
    charts: ['power', 'night'], rows: ['Power', 'Part life'],
    pass: (M) => min(M.power, M.night), minimize: { label: 'mass', unit: 'kg', value: (b) => b.P.power.mass },
    brief: ({ D }) => `Supply every load at ${D.name} for the whole mission, even through ${HAZARD[D.id]}. Use the lightest power system that does it.`,
    physics: ({ D }) => `Sunlight falls with the square of distance: ${D.name} gets ${pct(100 * Math.min(1 / (D.sunAU * D.sunAU), D.solarCap))} of Earth's. An RTG makes steady power anywhere, but it is heavy, pricey and warm.`,
  },
  {
    key: 'rocket', who: 'launch', title: 'Rocket', name: 'Lift it', steps: ['launcher'], craft: 'launcher',
    charts: ['mass', 'cost'], rows: ['Lift', 'Cost'],
    pass: (M) => min(M.mass, M.cost), minimize: { label: 'cost', unit: '$M', value: (b) => b.P.launcher.cost },
    brief: ({ b, C }) => `Lift the finished spacecraft (${Math.round(b.wet)} kg) and stay under $${C.budget}M. Use the cheapest rocket that does it.`,
    physics: () => 'A rocket lifts less as launch energy rises, and it has to lift everything every other lead added.',
  },
];

// Try every option on the page against the rest of the design. `cur` is the current choice,
// `best` is the cheapest option that meets the challenge (null if none can), `lean` means the
// current choice is that one.
export function challengeState(page, d) {
  const lists = page.steps.map((k) => STEPS.find((s) => s.key === k).list.map((o) => [k, o]));
  let combos = [[]];
  for (const l of lists) combos = combos.flatMap((c) => l.map((x) => [...c, x]));
  const all = combos.map((c) => {
    const t = { ...d };
    for (const [k, o] of c) { t[k] = o.id; if (o.set) Object.assign(t, o.set); }
    const b = budgets(t, ESTIMATE); const m = page.pass(budgetMargins(b));
    return { ids: c.map(([, o]) => o.id), met: typeof m === 'number' && m >= 0, margin: m, value: page.minimize.value(b) };
  });
  const cur = all.find((x) => page.steps.every((k, i) => x.ids[i] === d[k]));
  const met = all.filter((x) => x.met);
  const best = met.length ? met.reduce((a, x) => (x.value < a.value ? x : a)) : null;
  return { cur, met: cur.met, anyMet: met.length > 0, best, lean: cur.met && cur.value <= best.value + 1e-9 };
}
