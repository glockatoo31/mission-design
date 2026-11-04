// Systems-engineering layer: requirements, budget allocation, reserve and change control.
// Pure functions over the design. Shared by the app and scripts/balance.mjs.
//
// Allocated budgets: cost ($M) is split across four owners, and what is left is the system
// reserve. Power is allocated as loads (heaters, antenna, ion engine); the power system must
// then be sized to supply bus + payload + every allocated load.
import { BUS, PAYLOADS } from './data.js';
import { budgets, budgetMargins, marginColor, ESTIMATE, fmtYr } from './model.js';

export const SUBS = [
  { id: 'pt', label: 'Power & Thermal', lead: 'Power & Thermal Lead' },
  { id: 'comms', label: 'Comms', lead: 'Comms Lead' },
  { id: 'prop', label: 'Propulsion & Trajectory', lead: 'Propulsion & Trajectory Lead' },
  { id: 'launch', label: 'Launch', lead: 'Flight Director' },
];
export const POWER_USERS = ['pt', 'comms', 'prop']; // the rocket draws no power
export const SUB_LABEL = Object.fromEntries(SUBS.map((s) => [s.id, s.label]));
export const MIN_RESERVE = 0.05; // of the funding cap, held back when allocating
export const COST_STEP = 5;
export const POWER_STEP = 10;

const payloadOf = (C) => PAYLOADS.find((p) => p.id === C.payload);
export const fixedCost = (C) => BUS.cost + payloadOf(C).cost;
export const fixedPower = (C) => BUS.powerW + payloadOf(C).powerW;
export const costPool = (C) => C.budget - fixedCost(C);

// A naive even split that leaves 10% unallocated. It is deliberately wrong for every contract.
export function defaultAlloc(C) {
  const each = Math.floor((0.9 * costPool(C)) / SUBS.length / COST_STEP) * COST_STEP;
  return {
    cost: Object.fromEntries(SUBS.map((s) => [s.id, each])),
    power: Object.fromEntries(POWER_USERS.map((id) => [id, 60])),
  };
}

// Allocation plus any approved change request.
export const eff = (d, kind, id) => ((d.alloc && d.alloc[kind] && d.alloc[kind][id]) || 0) + ((d.cr && d.cr[`${kind}.${id}`]) || 0);
export const costReserve = (d, C) => C.budget - fixedCost(C) - SUBS.reduce((s, x) => s + eff(d, 'cost', x.id), 0);
export const powerRequired = (d, C) => fixedPower(C) + POWER_USERS.reduce((s, id) => s + eff(d, 'power', id), 0);

// What each owner's choices actually use.
export function usage(d) {
  const b = budgets(d, ESTIMATE); const P = b.P;
  return {
    b,
    cost: {
      pt: P.power.cost + P.thermal.cost,
      comms: P.comms.cost,
      prop: (P.engine ? P.engine.cost : 0) + P.tank.cost + b.opsCost,
      launch: P.launcher ? P.launcher.cost : 0,
    },
    power: { pt: b.heater, comms: P.comms.powerW, prop: P.engine && P.engine.lowThrust ? P.engine.powerW : 0 },
  };
}

// Allocation that exactly covers this design (debug helper, and the balance test's proof
// that every winning design can be run within its allocations).
export function fitAlloc(d) {
  const u = usage(d);
  return {
    cost: Object.fromEntries(SUBS.map((s) => [s.id, Math.ceil(u.cost[s.id])])),
    power: Object.fromEntries(POWER_USERS.map((id) => [id, Math.ceil(u.power[id])])),
  };
}

// Is every owner inside their allocation, is the reserve intact, and is the power system
// sized for what was allocated? `over` is the whole-number change request that would fix a row.
export function compliance(d) {
  const u = usage(d); const b = u.b; const C = b.C;
  const rows = [];
  for (const s of SUBS) rows.push({ kind: 'cost', sub: s.id, key: `cost.${s.id}`, used: u.cost[s.id], alloc: eff(d, 'cost', s.id) });
  for (const id of POWER_USERS) rows.push({ kind: 'power', sub: id, key: `power.${id}`, used: u.power[id], alloc: eff(d, 'power', id) });
  for (const r of rows) r.over = Math.max(0, Math.ceil(r.used - r.alloc - 1e-9));
  const reserve = costReserve(d, C);
  const required = powerRequired(d, C);
  const short = Math.max(0, Math.ceil(required - b.supplyEnd));
  return {
    rows, reserve, minReserve: Math.ceil(MIN_RESERVE * C.budget), required, supply: b.supplyEnd, short,
    ok: rows.every((r) => !r.over) && reserve >= 0 && short === 0,
  };
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
