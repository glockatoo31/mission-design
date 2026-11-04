// Trade studies: every choice has a few criteria that pull against each other. The trade table
// shows each option's value on each criterion; the lead records which one they optimised for;
// at review each decision is checked against that reason and shows what it gave up.
// Pure functions; shared by the app and scripts/balance.mjs.
import { STEPS } from './data.js';
import { parts, launchCapacity } from './model.js';
import { fmtU } from './syseng.js';

// `row` links a criterion to the interface row it loads, so a failure can be traced to the trade.
const CRITERIA = {
  comms: [
    { id: 'data', label: 'Data', unit: 'Gbit/yr', better: 'high', row: 'Data' },
    { id: 'power', label: 'Power', unit: 'W', better: 'low', row: 'Power' },
    { id: 'cost', label: 'Cost', unit: '$M', better: 'low', row: 'Cost' },
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
  ],
  tank: [
    { id: 'speed', label: 'Fuel', unit: 'kg', better: 'high', row: 'Burn' },
    { id: 'mass', label: 'Mass', unit: 'kg', better: 'low', row: 'Lift' },
    { id: 'cost', label: 'Cost', unit: '$M', better: 'low', row: 'Cost' },
  ],
  thermal: [
    { id: 'cool', label: 'Cooling', unit: 'x sun', better: 'high', row: 'Heat' },
    { id: 'shield', label: 'Shielding', unit: 'krad', better: 'high', row: 'Radiation' },
    { id: 'mass', label: 'Mass', unit: 'kg', better: 'low', row: 'Lift' },
  ],
  power: [
    { id: 'watts', label: 'Power', unit: 'W', better: 'high', row: 'Power' },
    { id: 'mass', label: 'Mass', unit: 'kg', better: 'low', row: 'Lift' },
    { id: 'cost', label: 'Cost', unit: '$M', better: 'low', row: 'Cost' },
  ],
  launcher: [
    { id: 'lift', label: 'Lift', unit: 'kg', better: 'high', row: 'Lift' },
    { id: 'cost', label: 'Cost', unit: '$M', better: 'low', row: 'Cost' },
  ],
};

// Each option's value on each criterion, at this destination.
const VALUE = {
  comms: (P, D) => ({ data: (P.comms.rateGb * D.contact) / (D.earthAU * D.earthAU), power: P.comms.powerW, cost: P.comms.cost }),
  tank: (P) => ({ speed: P.tank.prop, mass: P.tank.mass + P.tank.prop, cost: P.tank.cost }),
  thermal: (P) => ({ cool: P.thermal.hotLimit, shield: P.thermal.radTol, mass: P.thermal.mass }),
  power: (P, D) => ({ watts: P.power.solarW * Math.min(1 / (D.sunAU * D.sunAU), D.solarCap) + P.power.rtgW, mass: P.power.mass, cost: P.power.cost }),
  engine: (o) => ({ isp: o.isp, power: o.powerW || 0, cost: o.cost }),
  traj: (o, D) => { const t = D.traj[o.id]; return { time: t.cruise, burn: t.dv, cost: D.opsCostPerYr * (t.cruise + D.opsYears) }; },
  launcher: (o, D, d) => ({ lift: launchCapacity(o, D.traj[d.traj || 'direct'].c3), cost: o.cost }),
};

export function fmtC(c, v) {
  if (c.unit === 'Gbit/yr') return `${v >= 100 ? Math.round(v) : v.toFixed(1)} Gbit/yr`;
  if (c.unit === 's') return `${Math.round(v)} s`;
  return fmtU(v, c.unit);
}

// The trade table for one choice: options x criteria, with the best option per criterion.
export function trade(k, d) {
  const step = STEPS.find((s) => s.key === k); const P0 = parts(d); const D = P0.D;
  const criteria = CRITERIA[k];
  const options = step.list.map((o) => ({
    id: o.id, blurb: o.blurb,
    name: k === 'traj' ? (o.id === 'assist' ? `Assist: ${D.traj.assist.label}` : 'Direct') : o.name,
    vals: o.set ? VALUE[k](parts({ ...d, ...o.set }), D) : VALUE[k](o, D, d),
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
