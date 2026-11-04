// Systems-engineering layer: requirements and interfaces. Pure functions over the design;
// shared by the app and scripts/balance.mjs.
//
// Requirements flow down. The contract gives system requirements (R1-R7). Every design choice
// then puts derived requirements on other leads (a 90 W transmitter means Power must supply
// 90 W, and its amplifier means Thermal must reject the heat). Each interface row below is one
// such capacity check: what is needed, what the receiving lead's design provides, and who
// contributes to the need.
import { BUS, PAYLOADS, FLYBYS, RTG_HOT_FLUX, STRUCTURE_FRACTION } from './data.js';
import { budgets, budgetMargins, marginColor, ESTIMATE, fmtYr } from './model.js';

export const LEAD = {
  pt: 'Power & Thermal Lead', comms: 'Comms Lead', prop: 'Propulsion & Trajectory Lead', launch: 'Flight Director',
  sci: 'The contract (bus + instrument)', env: 'The destination',
};

export function fmtU(v, unit) {
  const n = Math.round(v);
  if (unit === 'W') return `${n} W`;
  if (unit === '$M') return `$${n}M`;
  if (unit === 'kg') return `${n} kg`;
  if (unit === 'm/s') return `${n} m/s`;
  if (unit === 'yr') return fmtYr(v);
  if (unit === 'krad') return `${n} krad`;
  if (unit === 'Gbit') return v >= 10 ? `${n} Gbit` : `${v.toFixed(1)} Gbit`;
  return `${v < 1 ? v.toFixed(2) : v.toFixed(1)}x sun`; // 'x sun'
}

const payloadOf = (C) => PAYLOADS.find((p) => p.id === C.payload);
const LIFE_OWNER = { power: 'pt', thermal: 'pt', comms: 'comms', engine: 'prop', payload: 'sci' };

// Interface rows: { label, to, unit, need, have, margin, sources: [{ from, text, v }] }.
// Rows whose inputs are not chosen yet are left out; sources with no value yet are left out.
export function interfaces(d) {
  const b = budgets(d, ESTIMATE); const { P, D, tr, C } = b;
  const rows = [];
  const add = (label, to, unit, need, have, margin, sources) => {
    if (need == null || !Number.isFinite(need)) return;
    rows.push({ label, to, unit, need, have: Number.isFinite(have) ? have : null, margin: typeof margin === 'number' ? margin : null, sources: sources.filter((s) => s.v != null && Number.isFinite(s.v) && s.v > 1e-9) });
  };
  const eng = P.engine; const rtgHeat = P.power.rtgUnits * RTG_HOT_FLUX;
  const bus = BUS.powerW + payloadOf(C).powerW;

  add('Power', 'pt', 'W', b.load, b.supplyEnd, b.powerMargin, [
    { from: 'sci', text: 'bus + instrument', v: bus },
    { from: 'comms', text: `transmitter (${P.comms.txW} W radio at 33%)`, v: P.comms.powerW },
    { from: 'pt', text: 'heaters', v: b.heater },
  ]);
  if (eng && eng.lowThrust) {
    add('Ion burn power', 'pt', 'W', b.ionLoad, b.supplyArrive, b.ionMargin, [
      { from: 'prop', text: 'ion engine', v: eng.powerW }, { from: 'sci', text: 'bus', v: BUS.powerW }, { from: 'pt', text: 'heaters', v: b.heater },
    ]);
  }
  add('Heat', 'pt', 'x sun', b.hotFlux, b.hotLimit, b.thermalMargin, [
    { from: 'env', text: 'sunlight', v: D.hotFlux },
    { from: 'comms', text: 'transmitter amplifier heat', v: P.comms.heatFlux },
    { from: 'pt', text: 'RTG waste heat', v: rtgHeat },
  ]);
  if (tr && tr.flyby === 'venus') {
    add('Venus flyby', 'pt', 'x sun', b.flybyFlux, b.hotLimit, b.flybyMargin, [
      { from: 'prop', text: 'Venus flyby route', v: FLYBYS.venus.flux },
      { from: 'comms', text: 'transmitter amplifier heat', v: P.comms.heatFlux },
      { from: 'pt', text: 'RTG waste heat', v: rtgHeat },
    ]);
  }
  if (tr) {
    add('Radiation', 'pt', 'krad', b.dose, b.radTol, b.radMargin, [
      { from: 'prop', text: `${fmtYr(tr.cruise)} trip${tr.flyby === 'jupiter' ? ' + Jupiter flyby' : ''}`, v: D.cruiseDosePerYr * tr.cruise + (tr.flyby ? FLYBYS[tr.flyby].dose : 0) },
      { from: 'env', text: `${fmtYr(D.opsYears)} at ${D.name}`, v: D.opsDosePerYr * D.opsYears },
    ]);
    if (b.weakest) {
      add('Part life', LIFE_OWNER[b.weakest.key] || 'pt', 'yr', b.years, b.weakest.part.life, b.lifeMargin, [
        { from: 'prop', text: 'trip length', v: tr.cruise }, { from: 'env', text: `time at ${D.name}`, v: D.opsYears },
      ]);
    }
  }
  add('Data', 'comms', 'Gbit', C.goalGb, b.returnable, b.dataMargin, [
    { from: 'sci', text: `instrument makes ${Math.round(b.genPerYr)} Gbit/yr for ${fmtYr(D.opsYears)}`, v: b.genPerYr * D.opsYears },
  ]);
  if (eng && tr) {
    const others = (BUS.mass + P.payload.mass + P.power.mass + P.thermal.mass + P.comms.mass) * (1 + STRUCTURE_FRACTION);
    add('Burn', 'prop', 'm/s', b.dvReq, b.dvAvail, b.dvMargin, [
      { from: 'prop', text: `${tr.label} route${b.dvPenalty > 1 ? ` (x${b.dvPenalty} for low thrust)` : ''}`, v: b.dvReq },
    ]);
    rows[rows.length - 1].note = `Dry mass of everyone else (${Math.round(others)} kg) comes out of this budget.`;
  }
  if (eng && b.cap != null) {
    const g = 1 + STRUCTURE_FRACTION;
    add('Lift', 'launch', 'kg', b.wet, b.cap, b.massMargin, [
      { from: 'sci', text: 'bus + instrument', v: (BUS.mass + P.payload.mass) * g },
      { from: 'pt', text: 'power + thermal', v: (P.power.mass + P.thermal.mass) * g },
      { from: 'comms', text: 'antenna + amplifier', v: P.comms.mass * g },
      { from: 'prop', text: 'engine + tank + fuel', v: (eng.mass + P.tank.mass) * g + P.tank.prop },
    ]);
  }
  add('Cost', 'launch', '$M', b.cost, b.budget, b.costMargin, [
    { from: 'sci', text: 'bus + instrument', v: BUS.cost + P.payload.cost },
    { from: 'pt', text: 'power + thermal', v: P.power.cost + P.thermal.cost },
    { from: 'comms', text: 'antenna', v: P.comms.cost },
    { from: 'prop', text: `engine + tank${tr ? ' + operations' : ''}`, v: (eng ? eng.cost : 0) + P.tank.cost + b.opsCost },
    { from: 'launch', text: 'rocket', v: P.launcher ? P.launcher.cost : 0 },
  ]);
  for (const r of rows) r.status = r.margin == null ? 'none' : marginColor(r.margin);
  return rows;
}

// Rows a lead must satisfy, and the sources other leads put into other leads' rows.
export const incoming = (rows, who) => rows.filter((r) => r.to === who);
export function outgoing(rows, who) {
  const out = [];
  for (const r of rows) for (const s of r.sources) if (s.from === who && r.to !== who) out.push({ row: r, src: s });
  return out;
}

// Which interface row a launch failure shows up in.
export function failRow(f, b) {
  if (!f) return null;
  if (f.mode === 'insertion') return f.ion ? 'Ion burn power' : 'Burn';
  if (f.mode === 'flyby') return b.tr.flyby === 'venus' ? 'Venus flyby' : 'Radiation';
  return {
    brownout: 'Power', freeze: 'Power', storm: 'Power', night: 'Power', overheat: 'Heat', radiation: 'Radiation',
    life: 'Part life', data: 'Data', launcher: 'Lift', cost: 'Cost',
  }[f.mode] || null;
}

// ---------- requirements ----------
// Derived from the contract. Each has an owner, the choices that satisfy it, and a margin.
const HAZARD_BY = {
  moon: 'Power · Thermal', mars: 'Power · Thermal', mercury: 'Thermal · Antenna', europa: 'Thermal · Route', pluto: 'Antenna · Power',
};

export function requirements(d) {
  const b = budgets(d, ESTIMATE); const M = budgetMargins(b); const { C, D } = b;
  const min = (...ms) => { const n = ms.filter((m) => typeof m === 'number'); return n.length ? Math.min(...n) : null; };
  const rows = [
    { id: 'R1', text: `Return ${C.goalGb} Gbit of science`, margin: M.data, owner: 'Comms Lead', by: 'Antenna · Instrument' },
    { id: 'R2', text: `Arrive within ${fmtYr(C.deadline)}`, margin: M.time, owner: 'Propulsion & Trajectory Lead', by: 'Route' },
    { id: 'R3', text: `Stay under $${C.budget}M`, margin: M.cost, owner: 'Flight Director', by: 'Every part · Rocket · Trip length' },
    { id: 'R4', text: `Survive: ${D.hazard.name}`, margin: b.hazardMargin, owner: D.id === 'pluto' ? 'Comms Lead' : 'Power & Thermal Lead', by: HAZARD_BY[D.id] },
    { id: 'R5', text: 'Fit the rocket\'s lift limit', margin: M.mass, owner: 'Flight Director', by: 'Rocket · Route · Part mass' },
    { id: 'R6', text: 'Make the arrival burn', margin: M.dv, owner: 'Propulsion & Trajectory Lead', by: 'Engine · Fuel · Route' },
    { id: 'R7', text: 'Stay powered, cool and working all mission', margin: min(M.power, M.thermal, M.rad, M.life), owner: 'Power & Thermal Lead', by: 'Power · Thermal · Part life' },
  ];
  for (const r of rows) r.status = marginColor(r.margin);
  return rows;
}

// Which requirement a launch failure violated.
const MODE_REQ = {
  data: 'R1', deadline: 'R2', cost: 'R3', night: 'R4', storm: 'R4', launcher: 'R5', insertion: 'R6',
  brownout: 'R7', freeze: 'R7', overheat: 'R7', radiation: 'R7', life: 'R7', flyby: 'R7',
};
export const reqFor = (f) => (f ? (f.hazard ? 'R4' : MODE_REQ[f.mode]) : null);
