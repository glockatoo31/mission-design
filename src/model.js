// Mission Design physics + outcome model. Pure functions, no DOM.
// Shared by the browser app and scripts/balance.mjs.
import {
  G0, STRUCTURE_FRACTION, BUS, MARGIN_GREEN, MIN_OPS_YEARS, FLYBYS, DESTINATIONS, CONTRACTS, PAYLOADS,
  ENGINES, LAUNCHERS, TANKS, COMMS_PARTS, POWER_PARTS, THERMAL_PARTS, TRAJECTORIES, RANDOM_EVENTS,
  PARAMS, BATTERY, BATTERY_LIFE, TCM, THERMAL, COMMS,
} from './data.js';
import { HERITAGE } from './parts.js';
import { PAR } from './par.js';

const byId = (list, id) => list.find((x) => x.id === id) || null;
const CRUISE_ARRAY_DEG = 0.02;
const R = Math.round;
const n1 = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

export const paramVal = (d, k) => (typeof d[k] === 'number' ? d[k] : PARAMS[k].def);

// ---------- parts: a chosen part type, sized by sliders -> mass / cost / performance ----------
function powerPart(d, D) {
  const part = byId(POWER_PARTS, d.power) || POWER_PARTS[1];
  const solar = part.kind === 'solar';
  const A = solar ? paramVal(d, 'solarArea') : 0; const n = solar ? 0 : paramVal(d, 'rtgUnits');
  const kWh = D && D.dark ? paramVal(d, 'battery') : BATTERY.defaultKWh;
  const mass = (solar ? part.massBase + part.massPerM2 * A : n * part.mass) + BATTERY.massBase + BATTERY.massPerKWh * kWh;
  const cost = (solar ? part.costBase + part.costPerM2 * A : n * part.cost) + BATTERY.costBase + BATTERY.costPerKWh * kWh;
  return {
    id: part.id, kind: part.kind, name: solar ? `${part.name}, ${n1(A)} m²` : `${n} × ${part.name}`, short: part.name,
    hasSolar: solar && A > 0, hasRtg: !solar && n > 0, solarW: A * (part.wPerM2 || 0), solarDeg: part.deg || 1,
    rtgUnits: n, rtgW: n * (part.unitW || 0), decay: part.decay || 0, rtgHeatW: n * (part.heatW || 0), hotFlux: n * (part.hotFlux || 0),
    batteryWh: kWh * 1000, mass, cost, life: part.life, heritage: part.heritage,
  };
}

function thermalPart(d) {
  const part = byId(THERMAL_PARTS, d.thermal) || THERMAL_PARTS[1];
  const R_ = paramVal(d, 'radiator'); const S = paramVal(d, 'shield');
  return {
    id: part.id, name: part.name, short: part.name,
    hotLimit: THERMAL.hotBase + THERMAL.hotPerRad * part.rad.cool * R_,
    heaterFactor: Math.max(THERMAL.heaterMin, THERMAL.heaterBase + THERMAL.heaterPerRad * part.rad.leak * R_ - THERMAL.heaterPerShield * S),
    radTol: THERMAL.radTolBase + THERMAL.radTolPerShield * part.shield.tol * S,
    mass: part.massBase + THERMAL.massPerRad * part.rad.mass * R_ + THERMAL.massPerShield * part.shield.mass * S,
    cost: part.costBase + THERMAL.costPerRad * part.rad.cost * R_ + THERMAL.costPerShield * part.shield.cost * S,
    life: part.life - THERMAL.lifePerRad * R_, heritage: part.heritage,
  };
}

function commsPart(d) {
  const part = byId(COMMS_PARTS, d.comms) || COMMS_PARTS[1];
  const dish = paramVal(d, 'dish'); const tx = paramVal(d, 'txPower');
  return {
    id: part.id, name: part.name, short: part.name,
    rateGb: COMMS.rateK * part.rate * dish * dish * tx, txW: tx, powerW: COMMS.drawPerTxW * tx, heatFlux: COMMS.heatPerTxW * tx,
    mass: (COMMS.massBase + COMMS.massPerD2 * dish * dish) * part.mass + COMMS.massPerTxW * tx,
    cost: (COMMS.costBase + COMMS.costPerD2 * dish * dish) * part.cost + COMMS.costPerTxW * tx,
    life: COMMS.lifeBase - COMMS.lifePerD * dish + part.life, heritage: part.heritage,
  };
}

function tankPart(d) {
  const part = byId(TANKS, d.tank) || TANKS[0];
  const prop = paramVal(d, 'fuel');
  return { id: part.id, name: `${part.name}, ${R(prop)} kg`, short: part.name, prop, mass: part.massBase + part.massPerKg * prop, cost: part.costBase + part.costPerKg * prop, life: part.life, heritage: part.heritage };
}

export function parts(d) {
  // From round 2 the contract is amended (d.changed): its patch overrides deadline, funding or goal.
  const C0 = byId(CONTRACTS, d.contract);
  const C = C0 && d.changed && C0.change ? { ...C0, ...C0.change.patch } : C0;
  const D = C ? byId(DESTINATIONS, C.dest) : null;
  return {
    C, D,
    payload: C ? byId(PAYLOADS, C.payload) : null,
    power: powerPart(d, D),
    thermal: thermalPart(d),
    comms: commsPart(d),
    engine: byId(ENGINES, d.engine),
    tank: tankPart(d),
    launcher: byId(LAUNCHERS, d.launcher),
    traj: byId(TRAJECTORIES, d.traj),
  };
}

export function isComplete(d) {
  const pw = byId(POWER_PARTS, d.power);
  return !!(d.contract && d.engine && d.traj && d.launcher && d.comms && d.thermal && d.tank && pw
    && (pw.kind === 'solar' ? paramVal(d, 'solarArea') > 0 : paramVal(d, 'rtgUnits') > 0));
}

// ---------- seeded randomness ----------
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Launch-day conditions: how much of the possible mass growth shows up (0-1), and one minor random event.
// The growth itself depends on the heritage of the parts (see budgets).
export function launchConditions(seed, attempt = 1) {
  const rng = mulberry32((seed * 7919 + attempt * 104729) >>> 0);
  rng(); rng();
  const growthK = Math.round(rng() * 1000) / 1000;
  const event = RANDOM_EVENTS[Math.floor(rng() * RANDOM_EVENTS.length)];
  const eventFrac = 0.15 + rng() * 0.6;
  return { growthK, event, eventFrac };
}

export const NOMINAL = { growthK: 0.5, event: null, eventFrac: 0.5 };
export const ESTIMATE = { growthK: 0, event: null, eventFrac: 0.5 };

// ---------- helpers ----------
const solarFactor = (D) => Math.min(1 / (D.sunAU * D.sunAU), D.solarCap);

function heaterW(D, P, coldW) {
  return Math.max(0, coldW * P.thermal.heaterFactor - P.power.rtgHeatW);
}

// Power from each source t years after launch. Cruise years degrade arrays a little;
// operations degrade them at the destination's rate. Each array type wears at its own rate.
// solarScale dims the arrays (dust storm).
function supplyParts(t, P, cruise, opts, flybyHit = 0, solarScale = 1) {
  const pw = P.power; const D = P.D;
  const f = (opts.event && opts.event.powerFactor) || 1;
  const tc = Math.min(t, cruise); const to = Math.max(0, t - cruise);
  const solar = pw.hasSolar
    ? pw.solarW * solarFactor(D) * Math.pow(1 - CRUISE_ARRAY_DEG * pw.solarDeg, tc) * Math.pow(1 - D.solarDeg * pw.solarDeg, to) * (1 - flybyHit) * solarScale * f : 0;
  const rtg = pw.hasRtg ? pw.rtgW * Math.pow(1 - pw.decay, t) * f : 0;
  return { solar, rtg };
}
function supplyAt(t, P, cruise, opts, flybyHit = 0) {
  const s = supplyParts(t, P, cruise, opts, flybyHit);
  return s.solar + s.rtg;
}

// ---------- time profiles (shared by simulate and the budget graphs) ----------
const FLYBY_WIDTH = 0.03; // years the Venus flyby heat spike lasts (graph + check)
export const STORM_YEARS = 0.1; // how long the Mars dust storm lasts

// Sunlight on the craft (x Earth), plus RTG waste heat. Heading outward it eases
// down to the destination's value; heading sunward the craft stays behind its
// cruise sunshade (about Earth level) until arrival. Plus the Venus flyby spike.
export function heatAt(t, b) {
  const { P, D, tr } = b;
  const rtg = P.power.hotFlux + P.comms.heatFlux;
  let f = t >= tr.cruise ? D.hotFlux : Math.min(1, Math.pow(D.hotFlux, t / tr.cruise));
  if (tr.flyby === 'venus' && Math.abs(t - tr.flybyYear) <= FLYBY_WIDTH) f = Math.max(f, FLYBYS.venus.flux);
  return f + rtg;
}

// Accumulated radiation dose (krad) t years after launch.
export function doseAt(t, b) {
  const { D, tr } = b; const ev = b.opts.event;
  let x = D.cruiseDosePerYr * Math.min(t, tr.cruise) + D.opsDosePerYr * Math.max(0, t - tr.cruise);
  if (tr.flyby && t >= tr.flybyYear) x += FLYBYS[tr.flyby].dose;
  if (ev && ev.dose && t >= tr.cruise * b.opts.eventFrac) x += ev.dose;
  return x;
}

// Electrical power available t years after launch. During cruise, solar output
// eases from Earth's sunlight to the destination's. Matches supplyAt() from arrival on.
export function powerAt(t, b) {
  const { P, D, tr } = b; const pw = P.power; const opts = b.opts;
  const f = (opts.event && opts.event.powerFactor) || 1;
  const hit = tr.flyby && t >= tr.flybyYear ? FLYBYS[tr.flyby].arrayHit : 0;
  if (t < tr.cruise) {
    const solar = pw.hasSolar ? pw.solarW * Math.pow(solarFactor(D), t / tr.cruise) * Math.pow(1 - CRUISE_ARRAY_DEG * pw.solarDeg, t) * (1 - hit) * f : 0;
    const rtg = pw.hasRtg ? pw.rtgW * Math.pow(1 - pw.decay, t) * f : 0;
    return solar + rtg;
  }
  const s = supplyParts(t, P, tr.cruise, opts, hit, inStorm(t, b) ? D.stormFactor : 1);
  return s.solar + s.rtg;
}

export function inStorm(t, b) {
  const { D, tr } = b;
  return !!D.stormFactor && t >= tr.cruise + D.stormYear && t <= tr.cruise + D.stormYear + STORM_YEARS;
}

// Power the spacecraft needs at its destination (survival mode during a dust storm).
export function needAt(t, b) {
  return inStorm(t, b) ? b.stormLoad : b.load;
}

export function launchCapacity(launcher, c3) {
  return launcher.baseKg * Math.exp(-c3 / launcher.falloff);
}

// ---------- budgets: everything the graphs and the review show ----------
export function budgets(d, opts = ESTIMATE) {
  const P = parts(d); const D = P.D; const C = P.C;
  const tr = D && d.traj ? D.traj[d.traj] : null;
  const ev = opts.event || {};
  const r = { P, D, C, tr, opts };

  // Mass
  const subs = [P.payload, P.power, P.thermal, P.comms, P.engine, P.tank];
  const sub = BUS.mass + subs.reduce((s, p) => s + (p ? p.mass : 0), 0);
  r.structure = sub * STRUCTURE_FRACTION;
  r.dryEst = sub + r.structure;
  // Hidden growth at launch: how much heavier than planned the hardware comes out depends on how
  // proven each part is (weighted by its mass); launch day decides how much of it shows up.
  const items = [[BUS.mass, 'proven'], ...subs.filter(Boolean).map((p) => [p.mass, p.heritage || 'proven'])];
  r.growthMax = items.reduce((x, [m, h]) => x + m * HERITAGE[h].growth, 0) / items.reduce((x, [m]) => x + m, 0);
  r.growth = (opts.growthK || 0) * r.growthMax;
  r.dry = r.dryEst * (1 + r.growth);
  r.prop = P.tank.prop;
  r.wet = r.dry + r.prop;
  r.cap = P.launcher && tr ? launchCapacity(P.launcher, tr.c3) : null;
  r.massMargin = r.cap != null ? (r.cap - r.wet) / r.cap : null;

  // Duration and deadline
  r.cruise = tr ? tr.cruise : null;
  r.opsYears = D ? D.opsYears : null;
  r.years = tr ? tr.cruise + D.opsYears : null;
  r.deadline = C ? C.deadline : null;
  r.timeMargin = tr && C ? (C.deadline - tr.cruise) / C.deadline : null;

  // Delta-v
  if (P.engine && tr) {
    r.dvAvail = P.engine.isp * (ev.ispFactor || 1) * G0 * Math.log(r.wet / r.dry);
    r.dvPenalty = P.engine.lowThrust ? D.lowThrustPenalty : 1;
    r.dvReq = (tr.dv + TCM.base + TCM.frac * tr.dv) * r.dvPenalty * (P.engine.dvMult || 1) + (ev.extraDv || 0);
    r.dvMargin = (r.dvAvail - r.dvReq) / r.dvReq;
  } else { r.dvAvail = r.dvReq = r.dvMargin = null; }

  // Power (worst case: end of mission)
  if (D) {
    r.heater = heaterW(D, P, D.coldW);
    r.mainLoad = BUS.powerW + (P.payload ? P.payload.powerW : 0) + P.comms.powerW;
    r.load = r.mainLoad + r.heater;
    const cruise = tr ? tr.cruise : 0; const yrs = cruise + D.opsYears;
    const hit = tr && tr.flyby ? FLYBYS[tr.flyby].arrayHit : 0;
    r.supplyArrive = supplyAt(cruise, P, cruise, opts, hit);
    r.supplyEnd = supplyAt(yrs, P, cruise, opts, hit);
    r.powerMargin = (r.supplyEnd - r.load) / r.load;
    if (P.engine && P.engine.lowThrust) {
      r.ionLoad = BUS.powerW + r.heater + P.engine.powerW;
      r.ionMargin = (r.supplyArrive - r.ionLoad) / r.ionLoad;
    }
  } else { r.powerMargin = null; }

  // Data
  if (D && P.payload) {
    r.genPerYr = P.payload.genGb;
    r.downPerYr = P.comms.rateGb * D.contact / (D.earthAU * D.earthAU) * (ev.dataFactor || 1);
    r.returnable = Math.min(r.genPerYr, r.downPerYr) * D.opsYears;
    r.goalGb = C.goalGb;
    r.dataMargin = (r.returnable - C.goalGb) / C.goalGb;
  } else { r.dataMargin = null; }

  // Thermal (hot side; cold side shows up as heater power)
  if (D) {
    r.hotFlux = D.hotFlux + P.power.hotFlux + P.comms.heatFlux;
    r.hotLimit = P.thermal.hotLimit;
    r.thermalMargin = (r.hotLimit - r.hotFlux) / r.hotLimit;
  } else { r.thermalMargin = null; }

  // Radiation
  if (D && tr) {
    const fb = tr.flyby ? FLYBYS[tr.flyby].dose : 0;
    r.dose = D.cruiseDosePerYr * tr.cruise + D.opsDosePerYr * D.opsYears + fb + (ev.dose || 0);
    r.radTol = P.thermal.radTol;
    r.radMargin = (r.radTol - r.dose) / r.radTol;
  } else { r.radMargin = null; }

  // Cost
  const partCost = BUS.cost + subs.reduce((s, p) => s + (p ? p.cost : 0), 0);
  r.partCost = partCost;
  r.launchCost = P.launcher ? P.launcher.cost : 0;
  r.opsCost = D && tr ? D.opsCostPerYr * r.years : 0;
  r.cost = partCost + r.launchCost + r.opsCost;
  r.budget = C ? C.budget : null;
  r.costMargin = C ? (C.budget - r.cost) / C.budget : null;

  // Dark periods (nights and eclipses) run on the battery. It may only be discharged to a limit, and
  // the deeper it is cycled the sooner it wears out. An RTG keeps supplying through the dark.
  if (D && D.dark) {
    const dk = D.dark;
    const rtgW = P.power.hasRtg ? supplyParts(r.years || 1, P, r.cruise || 0, opts).rtg : 0;
    r.nightLoad = BUS.survivalW + heaterW(D, P, D.coldW) + dk.ops * ((P.payload ? P.payload.powerW : 0) + P.comms.powerW);
    r.nightNeedWh = Math.max(0, r.nightLoad - rtgW) * dk.hours;
    r.batteryWh = P.power.batteryWh;
    r.usableWh = r.batteryWh * BATTERY_LIFE.dodMax;
    r.dod = r.nightNeedWh / r.batteryWh;
    r.darkMargin = r.nightNeedWh === 0 ? 1 : (r.usableWh - r.nightNeedWh) / r.nightNeedWh;
    r.batteryCycles = Math.min(BATTERY_LIFE.maxCycles, Math.max(BATTERY_LIFE.minCycles, BATTERY_LIFE.baseCycles * Math.pow(BATTERY_LIFE.refDod / Math.max(r.dod, 0.05), BATTERY_LIFE.exponent)));
    r.batteryYears = r.batteryCycles / dk.cyclesPerYr;
  }

  // Design life vs mission years
  if (tr) {
    const checks = [];
    for (const key of ['payload', 'power', 'thermal', 'comms']) if (P[key]) checks.push({ key, part: P[key], need: r.years });
    if (P.engine) checks.push({ key: 'engine', part: P.engine, need: tr.cruise });
    if (D.dark) checks.push({ key: 'battery', part: { name: 'Battery', life: r.batteryYears }, need: D.opsYears, offset: tr.cruise });
    r.lifeChecks = checks.map((c) => ({ ...c, margin: (c.part.life - c.need) / c.need }));
    r.weakest = r.lifeChecks.reduce((a, b2) => (!a || b2.margin < a.margin ? b2 : a), null);
    r.lifeMargin = r.weakest ? r.weakest.margin : null;
  } else { r.lifeMargin = null; }

  // Flyby hazard
  if (tr && tr.flyby) {
    const fb = FLYBYS[tr.flyby];
    if (tr.flyby === 'venus') {
      r.flybyFlux = fb.flux + P.power.hotFlux + P.comms.heatFlux;
      r.flybyMargin = (P.thermal.hotLimit - r.flybyFlux) / P.thermal.hotLimit;
    } else {
      r.flybyDose = D.cruiseDosePerYr * tr.flybyYear + fb.dose + (ev.dose || 0);
      r.flybyMargin = (P.thermal.radTol - r.flybyDose) / P.thermal.radTol;
    }
  } else { r.flybyMargin = tr ? 'na' : null; }

  // Destination-specific hazard
  r.hazardMargin = null;
  if (D) {
    if (D.id === 'mars') {
      const cruise = tr ? tr.cruise : 0;
      const s = supplyParts(cruise + D.stormYear, P, cruise, opts, 0, D.stormFactor);
      r.stormSupply = s.solar + s.rtg;
      r.stormLoad = BUS.survivalW + r.heater;
      r.hazardMargin = (r.stormSupply - r.stormLoad) / r.stormLoad;
    } else if (D.id === 'mercury') r.hazardMargin = r.thermalMargin;
    else if (D.id === 'europa') r.hazardMargin = r.radMargin;
    else if (D.id === 'pluto') r.hazardMargin = r.dataMargin;
  }
  return r;
}

export function marginColor(m) {
  if (m === 'na') return 'na';
  if (m == null || Number.isNaN(m)) return 'none';
  if (m < 0) return 'red';
  if (m < MARGIN_GREEN) return 'yellow';
  return 'green';
}

// ---------- launch simulation ----------
// Returns timeline events, the first failure (if any), and the outcome tier.
export function simulate(d, opts = NOMINAL) {
  const b = budgets(d, opts);
  const { P, D, tr } = b;
  const cruise = tr.cruise; const end = cruise + D.opsYears;
  const events = []; // {t, phase, text, fail?: {...}}
  const fails = [];
  const fail = (t, phase, mode, text, extra = {}) => fails.push({ t, phase, mode, text, hazard: hazardMode(D) === mode, ...extra });

  // Review gate (opts.bailout: attempt 1 flies anyway so every team sees a real failure)
  if (b.cost > b.budget && !opts.bailout) {
    return finish(b, opts, [], { t: 0, phase: 'review', mode: 'cost', text: `Program review: over budget by $${R(b.cost - b.budget)}M. Contract cancelled before launch.` });
  }

  // Liftoff
  if (b.wet > b.cap) fail(0, 'launch', 'launcher', `Launcher overloaded: ${R(b.wet)} kg vs ${R(b.cap)} kg capacity.`);

  // Contract deadline: the window closes while still in transit.
  if (cruise > b.deadline) fail(b.deadline, 'cruise', 'deadline', `Contract expired: still ${fmtYr(cruise - b.deadline)} from ${D.name} at the ${fmtYr(b.deadline)} deadline.`);

  // Cruise: flyby, random event, design-life expiry, radiation
  if (tr.flyby && tr.flybyYear < cruise) {
    const fb = FLYBYS[tr.flyby];
    events.push({ t: tr.flybyYear, phase: 'cruise', kind: 'flyby', text: fb.name });
    if (tr.flyby === 'venus' && b.flybyMargin < 0) {
      fail(tr.flybyYear, 'cruise', 'flyby', `Overheated at Venus: ${b.flybyFlux.toFixed(1)}x sunlight vs ${n1(P.thermal.hotLimit)}x limit.`);
    }
    if (tr.flyby === 'jupiter' && b.flybyMargin < 0) {
      fail(tr.flybyYear, 'cruise', 'flyby', `Jupiter flyby radiation: ${R(b.flybyDose)} krad vs ${R(P.thermal.radTol)} krad tolerance.`);
    }
  }
  if (opts.event) events.push({ t: cruise * opts.eventFrac, phase: 'cruise', kind: 'random', text: opts.event.text });
  for (const c of b.lifeChecks) {
    if (c.part.life < c.need) {
      const t = (c.offset || 0) + c.part.life; // the battery only ages once operations start
      const text = c.key === 'battery'
        ? `Battery wore out: ${R(b.batteryCycles)} cycles at ${R(b.dod * 100)}% depth of discharge, ${R(D.dark.cyclesPerYr * D.opsYears)} needed.`
        : `${c.part.name} reached its ${n1(c.part.life)}-year design life and failed.`;
      fail(t, t < cruise ? 'cruise' : 'ops', 'life', text, { lifePart: c });
    }
  }
  // Radiation: dose accumulates linearly, plus flyby spike
  const tol = P.thermal.radTol;
  if (doseAt(end, b) > tol && !(tr.flyby === 'jupiter' && b.flybyMargin < 0)) {
    const t = findFirst(0, end, (x) => doseAt(x, b) > tol);
    fail(t, t < cruise ? 'cruise' : 'ops', 'radiation', `Radiation dose hit ${R(doseAt(end, b))} krad vs ${R(tol)} krad tolerance.`);
  }

  // Arrival burn
  events.push({ t: cruise, phase: 'arrival', kind: 'arrival', text: 'Arrival burn' });
  if (P.engine.lowThrust && b.ionMargin < 0) {
    fail(cruise, 'arrival', 'insertion', `Ion engine starved: needs ${R(b.ionLoad)} W, power system gives ${R(b.supplyArrive)} W.`, { ion: true });
  }
  if (b.dvAvail < b.dvReq) {
    fail(cruise, 'arrival', 'insertion', `Missed orbit insertion: short by ${R(b.dvReq - b.dvAvail)} m/s.`);
  }

  // Operations
  if (b.hotFlux > b.hotLimit) fail(cruise + 0.01, 'ops', 'overheat', `Overheated: ${b.hotFlux.toFixed(1)}x sunlight vs ${n1(b.hotLimit)}x limit.`);
  const hit = tr.flyby ? FLYBYS[tr.flyby].arrayHit : 0;
  const mainShort = (t) => supplyAt(t, P, cruise, opts, hit) < b.mainLoad;
  const allShort = (t) => supplyAt(t, P, cruise, opts, hit) < b.load;
  if (mainShort(end)) {
    const t = findFirst(cruise, end, mainShort);
    const s = supplyAt(t, P, cruise, opts, hit);
    fail(t, 'ops', 'brownout', `Brownout: load ${R(b.mainLoad)} W, power ${R(s)} W.`, { supply: s });
  } else if (allShort(end)) {
    const t = findFirst(cruise, end, allShort);
    fail(t, 'ops', 'freeze', `Froze: no power left for ${R(b.heater)} W of heaters.`, { supply: supplyAt(t, P, cruise, opts, hit) });
  }
  if (D.dark) {
    events.push({ t: cruise + 0.04, phase: 'ops', kind: 'hazard', text: D.dark.label });
    if (b.darkMargin < 0) fail(cruise + 0.04, 'ops', 'night', `${D.dark.label}: needed ${(b.nightNeedWh / 1000).toFixed(1)} kWh, the battery can give ${(b.usableWh / 1000).toFixed(1)} kWh.`);
  }
  if (D.id === 'mars') {
    events.push({ t: cruise + D.stormYear, phase: 'ops', kind: 'hazard', text: 'Global dust storm' });
    if (b.hazardMargin < 0) fail(cruise + D.stormYear, 'ops', 'storm', `Dust storm: arrays gave ${R(b.stormSupply)} W, survival needs ${R(b.stormLoad)} W.`);
  }
  if (D.id === 'europa') events.push({ t: cruise + 0.1, phase: 'ops', kind: 'hazard', text: 'Radiation belts' });
  if (D.id === 'mercury') events.push({ t: cruise + 0.01, phase: 'ops', kind: 'hazard', text: '10x sunlight' });
  if (D.id === 'pluto') events.push({ t: cruise + 0.05, phase: 'ops', kind: 'hazard', text: 'Faint signal' });

  fails.sort((a, b2) => a.t - b2.t);
  // others: failures the design would have hit later (for the downstream warning)
  return { ...finish(b, opts, events, fails[0] || null), others: fails.slice(1) };
}

// One margin per budget graph: the numbers the review dashboard and the balance test use.
export function budgetMargins(b) {
  const min = (...ms) => { const n = ms.filter((m) => typeof m === 'number'); return n.length ? Math.min(...n) : null; };
  const m = {
    power: min(b.powerMargin, b.ionMargin, b.D.id === 'mars' ? b.hazardMargin : null),
    thermal: min(b.thermalMargin, b.tr.flyby === 'venus' ? b.flybyMargin : null),
    rad: min(b.radMargin, b.tr.flyby === 'jupiter' ? b.flybyMargin : null),
    data: b.dataMargin, time: b.timeMargin, cost: b.costMargin, mass: b.massMargin, dv: b.dvMargin, life: b.lifeMargin,
  };
  if (b.D.dark) m.night = b.darkMargin;
  return m;
}

function hazardMode(D) {
  return { mercury: 'overheat', mars: 'storm', europa: 'radiation', pluto: 'data' }[D.id];
}

function findFirst(a, b, pred) {
  const steps = 200;
  for (let i = 0; i <= steps; i++) { const t = a + (b - a) * (i / steps); if (pred(t)) return t; }
  return b;
}

function finish(b, opts, events, failure) {
  const { D, tr } = b;
  const cruise = tr.cruise; const end = cruise + D.opsYears;
  let opsTime = D.opsYears;
  if (failure) opsTime = Math.max(0, Math.min(D.opsYears, failure.t - cruise));
  if (failure && (failure.phase === 'review' || failure.phase === 'launch' || failure.phase === 'cruise' || failure.phase === 'arrival')) opsTime = 0;
  const rate = b.genPerYr != null ? Math.min(b.genPerYr, b.downPerYr) : 0;
  const scienceGb = rate * opsTime;
  let outcome = 'none';
  if (opsTime >= MIN_OPS_YEARS && scienceGb > 0) outcome = 'min';
  if (!failure && scienceGb >= b.goalGb) outcome = 'full';
  if (!failure && outcome === 'min') {
    failure = { t: end, phase: 'ops', mode: 'data', hazard: D.id === 'pluto', text: `Data shortfall: returned ${fmtGb(scienceGb)} of ${b.goalGb} Gbit goal (${R(100 * scienceGb / b.goalGb)}%).`, partial: true };
  }
  const points = R(100 * Math.min(1.5, scienceGb / b.goalGb));
  const score = R(points * D.mult);
  return { b, opts, events: events.sort((x, y) => x.t - y.t), failure, outcome, scienceGb, points, score, cost: b.cost, opsTime };
}

function pctSun(D) {
  const p = 100 * Math.min(D.solarCap, 1 / D.sunAU ** 2);
  return p >= 10 ? `${R(p)}%` : p >= 1 ? `${p.toFixed(1)}%` : `${p.toFixed(2)}%`;
}

export function fmtGb(x) {
  if (x >= 100) return `${R(x)} Gbit`;
  if (x >= 10) return `${x.toFixed(0)} Gbit`;
  return `${x.toFixed(1)} Gbit`;
}

// ---------- root-cause chains for the anomaly report ----------
// Each chain is a list of short steps that read left to right with arrows.
export function explain(d, res) {
  const f = res.failure; if (!f) return [];
  const b = res.b; const { P, D, tr, C } = b;
  const trLabel = d.traj === 'assist' ? `Assist (${tr.label})` : 'Direct trajectory';
  const growthPct = R((res.b.growth || 0) * 100);
  const chains = [];
  const est = budgets(d, ESTIMATE);
  const heavy = massDrivers(b).slice(0, 2).map((x) => `${x.name} (${R(x.mass)} kg)`);
  const units = P.power.rtgUnits;

  switch (f.mode) {
    case 'cost': {
      chains.push([`Parts $${R(b.partCost)}M`, `${P.launcher.name} $${b.launchCost}M`, `${trLabel} -> ${fmtYr(b.years)} of ops x $${D.opsCostPerYr}M/yr = $${R(b.opsCost)}M`, `Total $${R(b.cost)}M vs funding $${C.budget}M`, `Over by $${R(b.cost - C.budget)}M -> contract cancelled`]);
      const pricey = costDrivers(b)[0];
      if (pricey) chains.push([`Biggest spend: ${pricey.name} ($${R(pricey.cost)}M)`, 'Sizing it down or taking a smaller rocket saves the most']);
      break;
    }
    case 'deadline': {
      chains.push([`${trLabel} -> ${fmtYr(tr.cruise)} trip`, `Contract deadline: ${fmtYr(C.deadline)}`, `Still ${fmtYr(tr.cruise - C.deadline)} out when the window closed`, 'Contract expired']);
      if (d.traj === 'assist') chains.push([`Direct takes ${fmtYr(D.traj.direct.cruise)}`, 'but needs more launch energy', 'a bigger rocket and more money']);
      break;
    }
    case 'launcher': {
      const c = [`${trLabel} -> launch energy C3 = ${tr.c3}`, `${P.launcher.name} lifts only ${R(b.cap)} kg at that energy`];
      if (heavy.length) c.push(`Heaviest parts: ${heavy.join(', ')}`);
      c.push(`Dry ${R(b.dry)} kg + fuel ${R(b.prop)} kg = ${R(b.wet)} kg`);
      c.push(`Over by ${R(b.wet - b.cap)} kg -> launcher overload`);
      chains.push(c);
      if (est.wet <= b.cap) chains.push([`On paper it fit (${R(est.wet)} kg)`, `Real hardware came in ${growthPct}% heavier`, 'Zero margin -> overload. Margins matter.']);
      break;
    }
    case 'insertion': {
      if (f.ion) {
        chains.push([`${P.engine.name} needs ${P.engine.powerW} W to thrust`, `${P.power.name} gives ${R(b.supplyArrive)} W at ${D.name}`, `Short by ${R(b.ionLoad - b.supplyArrive)} W -> engine can't fire -> missed orbit insertion`]);
        break;
      }
      const c = [];
      if (heavy.length) c.push(`${heavy.join(' + ')}`);
      c.push(`Dry mass ${R(b.dry)} kg (incl. ${R(b.structure * (1 + b.growth))} kg structure)`);
      c.push(`${R(b.prop)} kg of fuel + ${P.engine.name} (Isp ${P.engine.isp} s) -> ${R(b.dvAvail)} m/s`);
      if (b.dvPenalty > 1) c.push(`Low thrust: needs ${b.dvPenalty}x more delta-v to capture`);
      c.push(`Needed ${R(b.dvReq)} m/s -> short by ${R(b.dvReq - b.dvAvail)} m/s -> missed orbit insertion`);
      chains.push(c);
      if (est.dvAvail >= est.dvReq) chains.push([`On paper you had ${R(est.dvAvail)} m/s`, `Hardware came in ${growthPct}% heavier`, 'Margin gone. Margins matter.']);
      if (res.opts.event && (res.opts.event.ispFactor || res.opts.event.extraDv)) chains.push([`Bad luck: ${res.opts.event.text}`, 'Small margin could not absorb it']);
      break;
    }
    case 'brownout': {
      const dist = [];
      if (P.power.hasSolar) dist.push(`${D.name} at ${D.sunAU} AU -> sunlight ${pctSun(D)} of Earth's`);
      if (P.power.hasRtg) dist.push(`RTGs decay ${(P.power.decay * 100).toFixed(1)}%/yr`);
      chains.push([
        `Load: bus ${BUS.powerW} W + ${P.payload.name} ${P.payload.powerW} W + transmitter ${P.comms.powerW} W (${P.comms.txW} W RF at 33%) = ${R(b.mainLoad)} W`,
        `${P.power.name}: ${R(P.power.solarW + P.power.rtgW)} W at Earth`, ...dist,
        `Year ${fmtYr(f.t, true)} -> only ${R(f.supply)} W`, `Short by ${R(b.mainLoad - f.supply)} W -> brownout`,
      ]);
      if (P.engine.lowThrust) chains.push(['Ion engine chosen', 'needed power', 'power system sized too small for science too']);
      break;
    }
    case 'freeze': {
      chains.push([
        `${D.name} is cold -> ${n1(paramVal(d, 'radiator'))} m² of radiators leak heat (heater factor ${n1(P.thermal.heaterFactor)}x) -> ${R(b.heater)} W of heaters`,
        `Heater added to load -> ${R(b.load)} W total`,
        `${P.power.name} gives ${R(f.supply)} W here (year ${fmtYr(f.t, true)})`,
        'Heaters starved -> froze',
      ]);
      if (!P.power.hasRtg) chains.push(['An RTG\'s waste heat would have kept you warm', 'but it costs mass and money']);
      break;
    }
    case 'overheat': {
      const c = [`${D.name}: ${D.hotFlux}x Earth sunlight`];
      if (units) c.push(`RTG waste heat adds +${n1(P.power.hotFlux)}x`);
      c.push(`${P.comms.txW} W transmitter's amplifier adds +${P.comms.heatFlux.toFixed(2)}x`);
      c.push(`${n1(paramVal(d, 'radiator'))} m² of radiators reject ${n1(P.thermal.hotLimit)}x`, 'Overheated on arrival');
      chains.push(c);
      break;
    }
    case 'flyby': {
      if (tr.flyby === 'venus') {
        const c = [`${trLabel} -> pass Venus at 0.7 AU`, `Sunlight ${FLYBYS.venus.flux}x Earth`];
        if (units) c.push(`+ RTG waste heat ${n1(P.power.hotFlux)}x`);
        c.push(`+ transmitter amplifier ${P.comms.heatFlux.toFixed(2)}x`);
        c.push(`Radiators reject ${n1(P.thermal.hotLimit)}x -> overheated in year ${fmtYr(tr.flybyYear, true)}`);
        chains.push(c);
      } else {
        chains.push([`${trLabel} -> pass close to Jupiter`, `+${FLYBYS.jupiter.dose} krad in one day`, `${n1(P.thermal.radTol)} krad of shielding`, `Total ${R(b.flybyDose)} krad -> electronics fried at Jupiter`]);
      }
      break;
    }
    case 'radiation': {
      const c = [];
      if (tr.flyby === 'jupiter') c.push(`Jupiter flyby +${FLYBYS.jupiter.dose} krad`);
      c.push(`${fmtYr(b.cruise)} cruise x ${D.cruiseDosePerYr} krad/yr`);
      if (D.opsDosePerYr > 5) c.push(`${D.name} operations ${D.opsDosePerYr} krad/yr`);
      if (res.opts.event && res.opts.event.dose) c.push(`Solar flare +${res.opts.event.dose} krad`);
      c.push(`${n1(paramVal(d, 'shield'))} cm of shielding tolerates ${R(P.thermal.radTol)} krad`, `Failed in year ${fmtYr(f.t, true)}`);
      chains.push(c);
      chains.push(['More shielding adds mass', 'mass costs fuel and rocket size', 'that is the trade']);
      break;
    }
    case 'life': {
      const c = f.lifePart;
      const steps = [];
      if (d.traj === 'assist') {
        const dir = budgets({ ...d, traj: 'direct' }, ESTIMATE);
        steps.push('Assist chosen');
        if (dir.cap != null && dir.massMargin < 0) steps.push(`(Direct would overload the ${P.launcher.name})`);
        else steps.push('launcher kept small (saved $)');
      } else steps.push('Direct trajectory');
      steps.push(`${fmtYr(c.need)} ${c.key === 'engine' ? 'until arrival burn' : c.key === 'battery' ? `of operations, ${R(D.dark.cyclesPerYr)} dark periods a year at ${R(b.dod * 100)}% depth of discharge` : 'mission'}`);
      steps.push(`${c.part.name} design life ${n1(c.part.life)} yr`);
      steps.push(`Failed in year ${Math.ceil(c.part.life + 0.001)}`);
      chains.push(steps);
      break;
    }
    case 'night': {
      const dk = D.dark;
      chains.push([
        `${dk.label}: ${dk.hours >= 72 ? `${R(dk.hours / 24)} days` : `${n1(dk.hours)} hours`} with no sun`,
        `Load in the dark: ${R(b.nightLoad)} W (bus, heaters${dk.ops ? `, ${R(dk.ops * 100)}% of instrument and radio` : ''})`,
        `x ${n1(dk.hours)} h = ${(b.nightNeedWh / 1000).toFixed(1)} kWh`,
        `Battery ${(b.batteryWh / 1000).toFixed(1)} kWh, usable to ${R(BATTERY_LIFE.dodMax * 100)}% = ${(b.usableWh / 1000).toFixed(1)} kWh`,
        'Battery ran down -> lost power in the dark',
      ]);
      break;
    }
    case 'storm': {
      chains.push([
        'Global dust storm: sunlight -80%',
        `${P.power.name} drops to ${R(b.stormSupply)} W`,
        `Survival needs bus ${BUS.survivalW} W + heaters ${R(b.heater)} W = ${R(b.stormLoad)} W`,
        'Brownout during the storm',
      ]);
      break;
    }
    case 'data': {
      const genLimited = b.genPerYr <= b.downPerYr;
      if (genLimited) {
        chains.push([`${P.payload.name} makes only ${fmtGb(b.genPerYr)}/yr`, `${fmtYr(res.opsTime)} of operations`, `Returned ${fmtGb(res.scienceGb)} of ${b.goalGb} Gbit goal`]);
      } else {
        chains.push([
          `${P.payload.name} makes ${fmtGb(b.genPerYr)}/yr`,
          `${P.comms.name} at ${D.earthAU} AU from Earth downlinks ${fmtGb(b.downPerYr)}/yr`,
          'Data piles up onboard',
          `Only ${R(100 * Math.min(b.downPerYr, b.genPerYr) * D.opsYears / b.goalGb)}% of goal returned`,
        ]);
      }
      break;
    }
    default: break;
  }
  return chains;
}

// Which parts weigh the most, and which cost the most, in the current design.
export function massDrivers(b) {
  const P = b.P;
  return [P.payload, P.power, P.thermal, P.comms, P.engine, P.tank].filter(Boolean)
    .map((p) => ({ name: p.name, mass: p.mass })).sort((a, c) => c.mass - a.mass);
}

export function costDrivers(b) {
  const P = b.P;
  return [P.payload, P.power, P.thermal, P.comms, P.engine, P.tank, P.launcher].filter(Boolean)
    .map((p) => ({ name: p.name, cost: p.cost })).sort((a, c) => c.cost - a.cost);
}

export function fmtYr(y, bare = false) {
  if (y < 0.1) return bare ? `${Math.max(1, R(y * 365))} days` : `${Math.max(1, R(y * 365))} days`;
  if (!bare && y < 1) return `${Math.max(1, R(y * 12))} months`;
  const s = y < 10 ? y.toFixed(1).replace(/\.0$/, '') : R(y).toString();
  return bare ? s : `${s} yr`;
}

// Short code to call out for the whiteboard: destination + 4 characters.
export function teamCode(d, seed, attempt) {
  const s = JSON.stringify(Object.keys(PARAMS).map((k) => paramVal(d, k))) + [d.contract, d.engine, d.traj, d.launcher].join('') + seed + attempt;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) { code += alphabet[(h >>> (i * 5)) & 31]; }
  const D = byId(DESTINATIONS, byId(CONTRACTS, d.contract).dest);
  return `${D.code}-${code}`;
}

// ---------- design space for the balance test and the par cost ----------
// Every part type, at a few sizes each. The app's sliders are continuous; this grid samples them.
// `changed` plays the amended contract.
const uniq = (xs) => [...new Set(xs)];
const r1 = (x) => Math.round(x * 10) / 10;

export function* designGrid(contractId, changed = false) {
  const C = byId(CONTRACTS, contractId); const D = byId(DESTINATIONS, C.dest);
  const batteries = D.dark ? [2, 6, 20] : [PARAMS.battery.def];
  const base = { contract: contractId, changed };
  for (const c of COMMS_PARTS) for (const dish of uniq([c.def.dish, Math.min(c.range.dish[1], r1(c.def.dish * 2))])) {
    const commsKnobs = { comms: c.id, dish, txPower: c.def.txPower };
    for (const p of POWER_PARTS) {
      const sizes = p.kind === 'solar' ? uniq([p.def.solarArea, Math.min(p.range.solarArea[1], p.def.solarArea * 3)]) : uniq([p.def.rtgUnits, Math.min(p.range.rtgUnits[1], p.def.rtgUnits + 1)]);
      for (const size of sizes) for (const battery of batteries) {
        const powerKnobs = { power: p.id, solarArea: p.kind === 'solar' ? size : 0, rtgUnits: p.kind === 'solar' ? 0 : size, battery };
        for (const t of THERMAL_PARTS) for (const [radiator, shield] of uniq([`${t.def.radiator},${t.def.shield}`, '8,1', '1,8']).map((s) => s.split(',').map(Number))) {
          const thermalKnobs = { thermal: t.id, radiator, shield };
          for (const k of TANKS) for (const fuel of [400, 1000]) for (const engine of ENGINES) for (const traj of TRAJECTORIES) for (const launcher of LAUNCHERS) {
            yield { ...base, ...commsKnobs, ...powerKnobs, ...thermalKnobs, tank: k.id, fuel, engine: engine.id, traj: traj.id, launcher: launcher.id };
          }
        }
      }
    }
  }
}

export function cheapestFull(contractId, opts = NOMINAL, changed = false) {
  let best = null;
  for (const d of designGrid(contractId, changed)) {
    const r = simulate(d, opts);
    if (r.outcome === 'full' && (!best || r.cost < best.cost)) best = { d, cost: r.cost };
  }
  return best;
}

// Par cost and par design: the cheapest full success. Precomputed (par.js), because searching the
// whole design space takes seconds; the balance test fails if par.js is out of date.
export function par(contractId, changed = false) {
  const e = PAR[contractId]; const x = e && (changed ? e.amended : e.base);
  return x ? x.cost : null;
}
export function parDesign(contractId, changed = false) {
  const e = PAR[contractId]; const x = e && (changed ? e.amended : e.base);
  return x ? { ...x.design } : null;
}
