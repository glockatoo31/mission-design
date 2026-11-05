// Systems-engineering layer: requirements and interfaces. Pure functions over the design;
// shared by the app and scripts/balance.mjs.
//
// Requirements flow down. The contract gives four requirements (R1-R4). Every design choice
// then puts derived requirements on other leads (a 90 W transmitter means Power must supply
// 90 W, and its amplifier means Thermal must reject the heat). Each interface row below is one
// such capacity check: what is needed, what the receiving lead's design provides, and who
// contributes to the need.
import { BUS, PAYLOADS, FLYBYS, STRUCTURE_FRACTION } from './data.js';
import { budgets, budgetMargins, marginColor, ESTIMATE, fmtYr } from './model.js';

export const LEAD = {
  pt: 'Power & Thermal Lead', comms: 'Comms Lead', prop: 'Propulsion & Trajectory Lead', launch: 'Flight Director',
  sci: 'The contract (bus + instrument)', env: 'The destination',
};

export function fmtU(v, unit) {
  const n = Math.round(v);
  if (unit === 'W') return `${n} W`;
  if (unit === 'kWh') return `${v.toFixed(v < 10 ? 2 : 1)} kWh`;
  if (unit === '$M') return `$${n}M`;
  if (unit === 'kg') return `${n} kg`;
  if (unit === 'm/s') return `${n} m/s`;
  if (unit === 'yr') return fmtYr(v);
  if (unit === 'krad') return `${n} krad`;
  if (unit === 'Gbit') return v >= 10 ? `${n} Gbit` : `${v.toFixed(1)} Gbit`;
  return `${v < 1 ? v.toFixed(2) : v.toFixed(1)}x sun`; // 'x sun'
}

const payloadOf = (C) => PAYLOADS.find((p) => p.id === C.payload);
const LIFE_OWNER = { power: 'pt', thermal: 'pt', comms: 'comms', engine: 'prop', payload: 'sci', battery: 'pt' };

// Interface rows: { label, to, unit, need, have, margin, sources: [{ from, text, v }] }.
// Rows whose inputs are not chosen yet are left out; sources with no value yet are left out.
export function interfaces(d) {
  const b = budgets(d, ESTIMATE); const { P, D, tr, C } = b;
  const rows = [];
  const add = (label, to, unit, need, have, margin, sources) => {
    if (need == null || !Number.isFinite(need)) return;
    rows.push({ label, to, unit, need, have: Number.isFinite(have) ? have : null, margin: typeof margin === 'number' ? margin : null, sources: sources.filter((s) => s.v != null && Number.isFinite(s.v) && s.v > 1e-9) });
  };
  const eng = P.engine; const rtgHeat = P.power.hotFlux;
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
      add('Part life', LIFE_OWNER[b.weakest.key] || 'pt', 'yr', b.weakest.need, b.weakest.part.life, b.lifeMargin, b.weakest.key === 'battery'
        ? [{ from: 'env', text: `${Math.round(D.dark.cyclesPerYr)} dark periods a year at ${Math.round(b.dod * 100)}% depth of discharge`, v: D.opsYears }]
        : [{ from: 'prop', text: 'trip length', v: tr.cruise }, { from: 'env', text: `time at ${D.name}`, v: D.opsYears }]);
    }
  }
  if (tr) add('Schedule', 'prop', 'yr', tr.cruise, C.deadline, b.timeMargin, [{ from: 'prop', text: `${tr.label} route`, v: tr.cruise }]);
  if (D.dark) {
    add('Dark period', 'pt', 'kWh', b.nightNeedWh / 1000, b.usableWh / 1000, b.darkMargin, [
      { from: 'sci', text: 'survival bus', v: (BUS.survivalW * D.dark.hours) / 1000 },
      { from: 'pt', text: 'heaters', v: (b.heater * D.dark.hours) / 1000 },
      { from: 'comms', text: 'radio and instrument kept on', v: (D.dark.ops * ((P.payload ? P.payload.powerW : 0) + P.comms.powerW) * D.dark.hours) / 1000 },
    ]);
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
    brownout: 'Power', freeze: 'Power', storm: 'Power', night: 'Dark period', overheat: 'Heat', radiation: 'Radiation',
    life: 'Part life', data: 'Data', launcher: 'Lift', cost: 'Cost', deadline: 'Schedule',
  }[f.mode] || null;
}

// ---------- requirements ----------
// Four plain requirements, derived from the contract. Each has an owner, the choices that
// satisfy it, and a margin (the thinnest of the budgets behind it).
const HAZARD_BY = {
  mars: 'Power · Thermal', mercury: 'Thermal · Antenna', europa: 'Thermal · Route', pluto: 'Antenna · Power',
};

export function requirements(d) {
  const b = budgets(d, ESTIMATE); const M = budgetMargins(b); const { C, D } = b;
  const min = (...ms) => { const n = ms.filter((m) => typeof m === 'number'); return n.length ? Math.min(...n) : null; };
  const rows = [
    { id: 'R1', name: 'Get there', text: `Get there: arrive within ${fmtYr(C.deadline)} and make the arrival burn`, margin: min(M.time, M.dv), owner: 'Propulsion & Trajectory Lead', by: 'Route · Engine · Fuel' },
    { id: 'R2', name: 'Do the science', text: `Do the science: return ${C.goalGb} Gbit`, margin: M.data, owner: 'Comms Lead', by: 'Antenna · Instrument' },
    // At Pluto the hazard is the faint signal, which is the science requirement already.
    { id: 'R3', name: 'Stay alive', text: `Stay alive: ${D.hazard.name}, power, heat and part life`, margin: min(M.power, M.thermal, M.rad, M.life, M.night, D.id === 'pluto' ? null : b.hazardMargin), owner: 'Power & Thermal Lead', by: HAZARD_BY[D.id] },
    { id: 'R4', name: 'Afford it and launch it', text: `Afford it: stay under $${C.budget}M and fit the rocket`, margin: min(M.cost, M.mass), owner: 'Flight Director', by: 'Every part · Rocket' },
  ];
  for (const r of rows) r.status = marginColor(r.margin);
  return rows;
}

// Which requirement a launch failure violated.
const MODE_REQ = {
  deadline: 'R1', insertion: 'R1', data: 'R2',
  night: 'R3', storm: 'R3', brownout: 'R3', freeze: 'R3', overheat: 'R3', radiation: 'R3', life: 'R3', flyby: 'R3',
  cost: 'R4', launcher: 'R4',
};
export const reqFor = (f) => (f ? MODE_REQ[f.mode] : null);
