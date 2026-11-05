// One page per subsystem, each with its own engineering mini-challenge:
//   meet this subsystem's requirement, with the least of its own cost.
// A challenge is checked live by trying other part types and sizes on the page against the rest of
// the spacecraft as it stands. Pure functions; shared by the app and scripts/balance.mjs.
import { STEPS, PARAMS } from './data.js';
import { budgets, budgetMargins, ESTIMATE, fmtYr, parts, paramVal } from './model.js';

const min = (...ms) => { const n = ms.filter((m) => typeof m === 'number'); return n.length ? Math.min(...n) : null; };
const pct = (x) => (x >= 10 ? `${Math.round(x)}%` : x >= 1 ? `${x.toFixed(1)}%` : `${x.toFixed(2)}%`);
const r1 = (x) => Math.round(x * 10) / 10;
const HAZARD = {
  mars: 'a global dust storm', mercury: '10x sunlight wearing the arrays out',
  europa: 'a long, dim cruise to Jupiter', pluto: 'a decade in near-darkness',
};
const list = (k) => STEPS.find((s) => s.key === k).list;
const partName = (k, id) => list(k).find((x) => x.id === id).name;

// pass: the margin that must be >= 0. minimize: what to keep as small as possible.
// rows: the interface rows (gauges) that belong to this page. knobs: the sliders on the page.
export const PAGES = [
  {
    key: 'comms', who: 'comms', title: 'Communications', name: 'Close the link', steps: ['comms'], craft: 'comms',
    charts: ['data'], rows: ['Data'], knobs: () => ['dish', 'txPower'],
    pass: (M) => M.data, minimize: { label: 'power draw', unit: 'W', value: (b) => b.P.comms.powerW },
    brief: ({ D, C }) => `Send ${C.goalGb} Gbit home from ${D.name}, ${D.earthAU} AU from Earth. Use as little power as you can.`,
    physics: () => 'A bigger dish and a stronger transmitter send more data. The amplifier is only 33% efficient: every radio watt draws 3 W and gives off heat. Ka-band sends more per dish but is newer.',
    candidates: () => list('comms').flatMap((c) => [0, 1, 2, 3].map((i) => r1(c.range.dish[0] + ((c.range.dish[1] - c.range.dish[0]) * i) / 3)).flatMap((dish) => [20, 40, 70].map((tx) => ({ comms: c.id, dish, txPower: tx })))),
    describe: (p) => `${partName('comms', p.comms)}, ${p.dish} m, ${p.txPower} W`,
  },
  {
    key: 'traj', who: 'prop', title: 'Trajectory', name: 'Make the window', steps: ['traj'], craft: 'traj',
    charts: ['time'], rows: ['Schedule', 'Burn'], knobs: () => [],
    pass: (M) => M.time, minimize: { label: 'burn', unit: 'm/s', value: (b) => b.tr.dv },
    brief: ({ C }) => `Arrive within ${fmtYr(C.deadline)}. Take the route with the smallest burn that still gets there in time.`,
    physics: () => 'Direct is quick and needs a big rocket. A gravity assist borrows speed from a planet: a smaller rocket and burn, but a longer trip.',
    candidates: () => list('traj').map((t) => ({ traj: t.id })),
    describe: (p, d, D) => (p.traj === 'assist' ? `Assist: ${D.traj.assist.label}` : 'Direct'),
  },
  {
    key: 'prop', who: 'prop', title: 'Propulsion', name: 'Make the burn', steps: ['engine', 'tank'], craft: 'engine',
    charts: ['dv'], rows: ['Burn', 'Ion burn power'], knobs: () => ['fuel'],
    pass: (M) => M.dv, minimize: { label: 'propulsion mass', unit: 'kg', value: (b) => b.P.engine.mass + b.P.tank.mass + b.P.tank.prop },
    brief: ({ b }) => `Deliver the ${Math.round(b.dvReq)} m/s the arrival needs: the burn plus a trajectory-correction allowance. Use the lightest engine, tank and fuel that do it.`,
    physics: () => 'Speed change follows the rocket equation: more fuel and a more efficient engine help, but every kilogram of fuel is mass you have to carry. Electric engines are efficient but need power.',
    candidates: () => list('engine').flatMap((e) => list('tank').flatMap((t) => [200, 400, 700, 1000, 1400].map((fuel) => ({ engine: e.id, tank: t.id, fuel })))),
    describe: (p) => `${partName('engine', p.engine)} + ${partName('tank', p.tank)}, ${p.fuel} kg`,
  },
  {
    key: 'thermal', who: 'pt', title: 'Thermal', name: 'Stay in range', steps: ['thermal'], craft: 'thermal',
    charts: ['thermal', 'rad'], rows: ['Heat', 'Venus flyby', 'Radiation'], knobs: () => ['radiator', 'shield'],
    pass: (M) => min(M.thermal, M.rad), minimize: { label: 'mass', unit: 'kg', value: (b) => b.P.thermal.mass },
    brief: ({ D }) => `Keep the spacecraft inside its limits at ${D.name}: ${D.thermalLabel.toLowerCase()}, with ${D.opsDosePerYr} krad of radiation a year there. Use the lightest thermal system that does it.`,
    physics: () => 'Radiators shed heat, but they leak it in the cold. Shielding blocks radiation and insulates. Both are mass, and each part type has its own mix.',
    candidates: () => list('thermal').flatMap((t) => [1, 3, 5, 8].flatMap((radiator) => [1, 3, 6, 9].map((shield) => ({ thermal: t.id, radiator, shield })))),
    describe: (p) => `${partName('thermal', p.thermal)}, ${p.radiator} m² radiators, ${p.shield} cm shielding`,
  },
  {
    key: 'power', who: 'pt', title: 'Power', name: 'Keep the lights on', steps: ['power'], craft: 'power',
    charts: ['power', 'night'], rows: ['Power', 'Dark period', 'Part life'],
    knobs: (d) => { const pw = list('power').find((p) => p.id === d.power); return [pw && pw.kind === 'rtg' ? 'rtgUnits' : 'solarArea', 'battery']; },
    pass: (M) => min(M.power, M.night), minimize: { label: 'mass', unit: 'kg', value: (b) => b.P.power.mass },
    brief: ({ D }) => `Supply every load at ${D.name} for the whole mission, even through ${HAZARD[D.id]}. Use the lightest power system that does it.`,
    physics: ({ D }) => `Sunlight falls with the square of distance: ${D.name} gets ${pct(100 * Math.min(1 / (D.sunAU * D.sunAU), D.solarCap))} of Earth's. ${D.dark ? `Through each ${D.dark.label.toLowerCase()} the battery carries the load, to no more than 80% depth, and the deeper it cycles the sooner it wears out. ` : ''}An RTG makes steady power anywhere, but it is heavy, pricey and warm.`,
    candidates: (d, D) => list('power').flatMap((p) => {
      const solar = p.kind === 'solar'; const [lo, hi] = solar ? p.range.solarArea : p.range.rtgUnits;
      const sizes = solar ? [4, 8, 14, 24, 36].filter((x) => x >= lo && x <= hi) : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
      return sizes.flatMap((s) => (D.dark ? [2, 4, 8, 14, 22, 30] : [paramVal(d, 'battery')]).map((battery) => ({ power: p.id, solarArea: solar ? s : 0, rtgUnits: solar ? 0 : s, battery })));
    }),
    describe: (p) => (p.solarArea ? `${partName('power', p.power)}, ${p.solarArea} m²` : `${p.rtgUnits} × ${partName('power', p.power)}`),
  },
  {
    key: 'rocket', who: 'launch', title: 'Rocket', name: 'Lift it', steps: ['launcher'], craft: 'launcher',
    charts: ['mass', 'cost'], rows: ['Lift', 'Cost'], knobs: () => [],
    pass: (M) => M.mass, minimize: { label: 'cost', unit: '$M', value: (b) => b.P.launcher.cost },
    brief: ({ b }) => `Lift the finished spacecraft (${Math.round(b.wet)} kg). Use the cheapest rocket that does it.`,
    physics: () => 'A rocket lifts less as launch energy rises, and it has to lift everything every other lead added, including the mass growth you cannot see yet.',
    candidates: () => list('launcher').map((l) => ({ launcher: l.id })),
    describe: (p) => partName('launcher', p.launcher),
  },
];

// The sliders on a page for the part that is currently chosen: key, label, unit, range, step.
export function knobsFor(page, d) {
  return page.knobs(d).map((k) => {
    const P = PARAMS[k]; let [lo, hi] = [P.min, P.max];
    const owner = { dish: 'comms', txPower: null, solarArea: 'power', rtgUnits: 'power' }[k];
    const part = owner ? list(owner).find((x) => x.id === d[owner]) : null;
    if (part && part.range && part.range[k]) [lo, hi] = part.range[k];
    return { key: k, label: P.label, unit: P.unit, min: lo, max: hi, step: P.step };
  });
}

// Try other part types and sizes on the page against the rest of the design. `cur` is the
// current choice, `best` the lightest candidate that meets the challenge (null if none can), and
// `lean` means the current choice is within 10% of it.
export function challengeState(page, d) {
  const D = parts(d).D;
  const evalDesign = (t) => { const b = budgets(t, ESTIMATE); const m = page.pass(budgetMargins(b)); return { met: typeof m === 'number' && m >= 0, margin: m, value: page.minimize.value(b) }; };
  const cur = evalDesign(d);
  let best = null;
  for (const patch of page.candidates(d, D)) {
    const r = evalDesign({ ...d, ...patch });
    if (r.met && (!best || r.value < best.value)) best = { ...r, patch, label: page.describe(patch, d, D) };
  }
  return { cur, met: cur.met, anyMet: !!best || cur.met, best, lean: cur.met && (!best || cur.value <= best.value * 1.1 + 1e-9) };
}
