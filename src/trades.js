// Trade studies: every choice has a few criteria that pull against each other. The trade table
// shows each option's value on each criterion (at the part's typical size; the sliders resize it);
// the lead records which one they optimised for; at review each decision is checked against that
// reason and shows what it gave up.
// Pure functions; shared by the app and scripts/balance.mjs.
import { STEPS } from './data.js';
import { HERITAGE } from './parts.js';
import { parts, launchCapacity } from './model.js';
import { fmtU } from './syseng.js';

// `row` links a criterion to the interface row it loads, so a failure can be traced to the trade.
// `risk` is the heritage criterion: how much heavier than planned this part tends to come out.
const RISK = { id: 'risk', label: 'Risk', unit: '%', better: 'low', row: 'Lift' };
const CRITERIA = {
  comms: [
    { id: 'data', label: 'Data', unit: 'Gbit/yr', better: 'high', row: 'Data' },
    { id: 'power', label: 'Power', unit: 'W', better: 'low', row: 'Power' },
    { id: 'cost', label: 'Cost', unit: '$M', better: 'low', row: 'Cost' },
    RISK,
  ],
  traj: [
    { id: 'time', label: 'Speed', unit: 'yr', better: 'low', row: 'Schedule' },
    { id: 'burn', label: 'Burn', unit: 'm/s', better: 'low', row: 'Burn' },
    { id: 'cost', label: 'Cost', unit: '$M', better: 'low', row: 'Cost' },
  ],
  engine: [
    { id: 'isp', label: 'Efficiency', unit: 's', better: 'high', row: 'Burn' },
    { id: 'power', label: 'Power', unit: 'W', better: 'low', row: 'Ion burn power' },
    { id: 'cost', label: 'Cost', unit: '$M', better: 'low', row: 'Cost' },
    RISK,
  ],
  tank: [
    { id: 'speed', label: 'Fuel', unit: 'kg', better: 'high', row: 'Burn' },
    { id: 'mass', label: 'Mass', unit: 'kg', better: 'low', row: 'Lift' },
    { id: 'cost', label: 'Cost', unit: '$M', better: 'low', row: 'Cost' },
    RISK,
  ],
  thermal: [
    { id: 'cool', label: 'Cooling', unit: 'x sun', better: 'high', row: 'Heat' },
    { id: 'shield', label: 'Shielding', unit: 'krad', better: 'high', row: 'Radiation' },
    { id: 'mass', label: 'Mass', unit: 'kg', better: 'low', row: 'Lift' },
    RISK,
  ],
  power: [
    { id: 'watts', label: 'Power', unit: 'W', better: 'high', row: 'Power' },
    { id: 'mass', label: 'Mass', unit: 'kg', better: 'low', row: 'Lift' },
    { id: 'cost', label: 'Cost', unit: '$M', better: 'low', row: 'Cost' },
    RISK,
  ],
  launcher: [
    { id: 'lift', label: 'Lift', unit: 'kg', better: 'high', row: 'Lift' },
    { id: 'cost', label: 'Cost', unit: '$M', better: 'low', row: 'Cost' },
  ],
};

const risk = (o) => HERITAGE[o.heritage || 'proven'].growth * 100;

// Each option's value on each criterion, at this destination.
const VALUE = {
  comms: (P, D, o) => ({ data: (P.comms.rateGb * D.contact) / (D.earthAU * D.earthAU), power: P.comms.powerW, cost: P.comms.cost, risk: risk(o) }),
  tank: (P, D, o) => ({ speed: P.tank.prop, mass: P.tank.mass + P.tank.prop, cost: P.tank.cost, risk: risk(o) }),
  thermal: (P, D, o) => ({ cool: P.thermal.hotLimit, shield: P.thermal.radTol, mass: P.thermal.mass, risk: risk(o) }),
  power: (P, D, o) => ({ watts: P.power.solarW * Math.min(1 / (D.sunAU * D.sunAU), D.solarCap) + P.power.rtgW, mass: P.power.mass, cost: P.power.cost, risk: risk(o) }),
  engine: (o) => ({ isp: o.isp, power: o.powerW || 0, cost: o.cost, risk: risk(o) }),
  traj: (o, D) => { const t = D.traj[o.id]; return { time: t.cruise, burn: t.dv, cost: D.opsCostPerYr * (t.cruise + D.opsYears) }; },
  launcher: (o, D, d) => ({ lift: launchCapacity(o, D.traj[d.traj || 'direct'].c3), cost: o.cost }),
};

export function fmtC(c, v) {
  if (c.unit === 'Gbit/yr') return `${v >= 100 ? Math.round(v) : v.toFixed(1)} Gbit/yr`;
  if (c.unit === 's') return `${Math.round(v)} s`;
  if (c.unit === '%') return `${Math.round(v)}%`;
  return fmtU(v, c.unit);
}

// The trade table for one choice: options x criteria, with the best option per criterion.
// A part is shown at its typical size (`def`), so types compare like for like.
export function trade(k, d) {
  const step = STEPS.find((s) => s.key === k); const D = parts(d).D;
  const criteria = CRITERIA[k];
  const options = step.list.map((o) => ({
    id: o.id, blurb: o.blurb, heritage: o.heritage || null,
    name: k === 'traj' ? (o.id === 'assist' ? `Assist: ${D.traj.assist.label}` : 'Direct') : o.name,
    vals: o.def && k !== 'launcher' ? VALUE[k](parts({ ...d, [k]: o.id, ...o.def }), D, o) : VALUE[k](o, D, d),
  }));
  const bestVal = Object.fromEntries(criteria.map((c) => {
    const xs = options.map((o) => o.vals[c.id]);
    return [c.id, c.better === 'high' ? Math.max(...xs) : Math.min(...xs)];
  }));
  const isBest = (o, c) => o.vals[c.id] === bestVal[c.id];
  return { criteria, options, bestVal, isBest };
}

// Every decision in the design: what was chosen, why, whether it is the best on that reason,
// and what it gave up on the other criteria (largest give-up first).
export function decisions(d) {
  return STEPS.map((s) => {
    const t = trade(s.key, d); const option = t.options.find((o) => o.id === d[s.key]);
    const why = t.criteria.find((c) => c.id === (d.why || {})[s.key]) || null;
    const gaps = t.criteria.filter((c) => !t.isBest(option, c)).map((c) => {
      const v = option.vals[c.id]; const best = t.bestVal[c.id];
      return { crit: c, value: v, best, bestOption: t.options.find((o) => o.vals[c.id] === best).name, gap: Math.abs(v - best) / Math.max(Math.abs(v), Math.abs(best), 1e-9) };
    }).sort((a, b) => b.gap - a.gap);
    return { key: s.key, label: s.label, option, why, whyBest: why ? t.isBest(option, why) : null, gaps };
  });
}

// What a decision gave up, other than the thing it was chosen for.
export const gaveUp = (x) => x.gaps.filter((g) => !x.why || g.crit.id !== x.why.id);
