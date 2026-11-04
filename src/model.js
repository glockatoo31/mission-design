// Mission Design physics + outcome model. Pure functions, no DOM.
// Shared by the browser app and scripts/balance.mjs.
import {
  G0, STRUCTURE_FRACTION, MASS_GROWTH_MAX, BUS, RTG_HEATER_CREDIT_W, RTG_HOT_FLUX,
  MARGIN_GREEN, MIN_OPS_YEARS, FLYBYS, DESTINATIONS, PAYLOADS, POWER, THERMAL, COMMS,
  ENGINES, TANKS, LAUNCHERS, TRAJECTORIES, RANDOM_EVENTS, SLOTS,
} from './data.js';

const byId = (list, id) => list.find((x) => x.id === id) || null;
const CRUISE_ARRAY_DEG = 0.02;

export function parts(d) {
  return {
    D: byId(DESTINATIONS, d.dest),
    payload: byId(PAYLOADS, d.payload),
    power: byId(POWER, d.power),
    thermal: byId(THERMAL, d.thermal),
    comms: byId(COMMS, d.comms),
    engine: byId(ENGINES, d.engine),
    tank: byId(TANKS, d.tank),
    launcher: byId(LAUNCHERS, d.launcher),
    traj: byId(TRAJECTORIES, d.traj),
  };
}

export function isComplete(d) {
  return SLOTS.every((s) => d[s.key]) && !!d.dest;
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

// Launch-day conditions: hidden mass growth and one minor random event.
export function launchConditions(seed, attempt = 1) {
  const rng = mulberry32((seed * 7919 + attempt * 104729) >>> 0);
  rng(); rng();
  const growth = Math.round(rng() * MASS_GROWTH_MAX * 1000) / 1000;
  const event = RANDOM_EVENTS[Math.floor(rng() * RANDOM_EVENTS.length)];
  const eventFrac = 0.15 + rng() * 0.6;
  return { growth, event, eventFrac };
}

export const NOMINAL = { growth: MASS_GROWTH_MAX / 2, event: null, eventFrac: 0.5 };
export const ESTIMATE = { growth: 0, event: null, eventFrac: 0.5 };

// ---------- helpers ----------
const solarFactor = (D) => Math.min(1 / (D.sunAU * D.sunAU), D.solarCap);

function heaterW(D, P, coldW) {
  if (!P.thermal) return 0;
  const credit = P.power && P.power.type === 'rtg' ? RTG_HEATER_CREDIT_W : 0;
  return Math.max(0, coldW * P.thermal.heaterFactor - credit);
}

// Power available t years after launch (cruise years at mild degradation, ops at destination rate).
function supplyAt(t, P, cruise, opts, flybyHit = 0) {
  const pw = P.power; const D = P.D;
  if (!pw) return 0;
  const f = (opts.event && opts.event.powerFactor) || 1;
  if (pw.type === 'rtg') return pw.outW * Math.pow(1 - pw.decay, t) * f;
  const tc = Math.min(t, cruise); const to = Math.max(0, t - cruise);
  return pw.outW * solarFactor(D) * Math.pow(1 - CRUISE_ARRAY_DEG, tc) * Math.pow(1 - D.solarDeg, to) * (1 - flybyHit) * f;
}

// ---------- time profiles (shared by simulate and the budget graphs) ----------
// All take the result of budgets() so they see the same parts and launch conditions.
const FLYBY_WIDTH = 0.03; // years the Venus flyby heat spike lasts (graph + check)
export const STORM_YEARS = 0.1; // how long the Mars dust storm lasts

// Sunlight on the craft (x Earth), plus RTG waste heat. Heading outward it eases
// down to the destination's value; heading sunward the craft stays behind its
// cruise sunshade (about Earth level) until arrival. Plus the Venus flyby spike.
export function heatAt(t, b) {
  const { P, D, tr } = b;
  const rtg = P.power && P.power.type === 'rtg' ? RTG_HOT_FLUX : 0;
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
  if (!pw) return 0;
  const f = (opts.event && opts.event.powerFactor) || 1;
  if (pw.type === 'rtg') return pw.outW * Math.pow(1 - pw.decay, t) * f;
  const hit = tr.flyby && t >= tr.flybyYear ? FLYBYS[tr.flyby].arrayHit : 0;
  if (t < tr.cruise) return pw.outW * Math.pow(solarFactor(D), t / tr.cruise) * Math.pow(1 - CRUISE_ARRAY_DEG, t) * (1 - hit) * f;
  let s = supplyAt(t, P, tr.cruise, opts, hit);
  if (inStorm(t, b)) s *= D.stormFactor;
  return s;
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

// ---------- budgets: everything the live strip and review show ----------
export function budgets(d, opts = ESTIMATE) {
  const P = parts(d); const D = P.D;
  const tr = D && d.traj ? D.traj[d.traj] : null;
  const ev = opts.event || {};
  const r = { P, D, tr, opts };

  // Mass
  const subs = [P.payload, P.power, P.thermal, P.comms, P.engine, P.tank];
  const sub = BUS.mass + subs.reduce((s, p) => s + (p ? p.mass : 0), 0);
  r.structure = sub * STRUCTURE_FRACTION;
  r.dryEst = sub + r.structure;
  r.dry = r.dryEst * (1 + (opts.growth || 0));
  r.prop = P.tank ? P.tank.prop : 0;
  r.wet = r.dry + r.prop;
  r.cap = P.launcher && tr ? launchCapacity(P.launcher, tr.c3) : null;
  r.massMargin = r.cap != null ? (r.cap - r.wet) / r.cap : null;

  // Duration
  r.cruise = tr ? tr.cruise : null;
  r.opsYears = D ? D.opsYears : null;
  r.years = tr ? tr.cruise + D.opsYears : null;

  // Delta-v
  if (P.engine && P.tank && tr) {
    r.dvAvail = P.engine.isp * (ev.ispFactor || 1) * G0 * Math.log(r.wet / r.dry);
    r.dvPenalty = P.engine.lowThrust ? D.lowThrustPenalty : 1;
    r.dvReq = tr.dv * r.dvPenalty + (ev.extraDv || 0);
    r.dvMargin = (r.dvAvail - r.dvReq) / r.dvReq;
  } else { r.dvAvail = r.dvReq = r.dvMargin = null; }

  // Power (worst case: end of mission)
  if (D && P.power && P.thermal) {
    r.heater = heaterW(D, P, D.coldW);
    r.mainLoad = BUS.powerW + (P.payload ? P.payload.powerW : 0) + (P.comms ? P.comms.powerW : 0);
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
  if (D && P.payload && P.comms) {
    r.genPerYr = P.payload.genGb;
    r.downPerYr = P.comms.rateGb * D.contact / (D.earthAU * D.earthAU) * (ev.dataFactor || 1);
    r.returnable = Math.min(r.genPerYr, r.downPerYr) * D.opsYears;
    r.dataMargin = (r.returnable - D.fullGb) / D.fullGb;
  } else { r.dataMargin = null; }

  // Thermal (hot side; cold side shows up as heater power)
  if (D && P.thermal) {
    const rtg = P.power && P.power.type === 'rtg' ? RTG_HOT_FLUX : 0;
    r.hotFlux = D.hotFlux + rtg;
    r.hotLimit = P.thermal.hotLimit;
    r.thermalMargin = (r.hotLimit - r.hotFlux) / r.hotLimit;
  } else { r.thermalMargin = null; }

  // Radiation
  if (D && P.thermal && tr) {
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
  r.budget = D ? D.budget : null;
  r.costMargin = D ? (D.budget - r.cost) / D.budget : null;

  // Design life vs mission years
  if (tr) {
    const checks = [];
    for (const key of ['payload', 'power', 'thermal', 'comms']) if (P[key]) checks.push({ key, part: P[key], need: r.years });
    if (P.engine) checks.push({ key: 'engine', part: P.engine, need: tr.cruise });
    r.lifeChecks = checks.map((c) => ({ ...c, margin: (c.part.life - c.need) / c.need }));
    r.weakest = r.lifeChecks.reduce((a, b) => (!a || b.margin < a.margin ? b : a), null);
    r.lifeMargin = r.weakest ? r.weakest.margin : null;
  } else { r.lifeMargin = null; }

  // Flyby hazard
  if (tr && tr.flyby && P.thermal) {
    const fb = FLYBYS[tr.flyby];
    if (tr.flyby === 'venus') {
      const rtg = P.power && P.power.type === 'rtg' ? RTG_HOT_FLUX : 0;
      r.flybyFlux = fb.flux + rtg;
      r.flybyMargin = (P.thermal.hotLimit - r.flybyFlux) / P.thermal.hotLimit;
    } else {
      r.flybyDose = D.cruiseDosePerYr * tr.flybyYear + fb.dose + (ev.dose || 0);
      r.flybyMargin = (P.thermal.radTol - r.flybyDose) / P.thermal.radTol;
    }
  } else { r.flybyMargin = tr ? 'na' : null; }

  // Destination-specific hazard
  r.hazardMargin = null;
  if (D && P.power && P.thermal) {
    if (D.id === 'moon') {
      const night = BUS.survivalW + heaterW(D, P, D.coldW);
      const rtgW = P.power.type === 'rtg' ? supplyAt(r.years || 1, P, r.cruise || 0, opts) : 0;
      r.nightLoad = night;
      r.nightNeedWh = Math.max(0, night - rtgW) * D.nightHours;
      r.batteryWh = P.power.batteryWh;
      r.hazardMargin = r.nightNeedWh === 0 ? 1 : (r.batteryWh - r.nightNeedWh) / r.nightNeedWh;
    } else if (D.id === 'mars') {
      const cruise = tr ? tr.cruise : 0;
      const s = supplyAt(cruise + D.stormYear, P, cruise, opts);
      r.stormSupply = P.power.type === 'solar' ? s * D.stormFactor : s;
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

  // Review gate
  if (b.cost > b.budget) {
    return finish(b, opts, [], { t: 0, phase: 'review', mode: 'cost', text: `Program review: over budget by $${Math.round(b.cost - b.budget)}M. Mission cancelled before launch.` });
  }

  // Liftoff
  if (b.wet > b.cap) fail(0, 'launch', 'launcher', `Launcher overloaded: ${Math.round(b.wet)} kg vs ${Math.round(b.cap)} kg capacity.`);

  // Cruise: flyby, random event, design-life expiry, radiation
  if (tr.flyby && tr.flybyYear < cruise) {
    const fb = FLYBYS[tr.flyby];
    events.push({ t: tr.flybyYear, phase: 'cruise', kind: 'flyby', text: fb.name });
    if (tr.flyby === 'venus' && b.flybyMargin < 0) {
      fail(tr.flybyYear, 'cruise', 'flyby', `Overheated at Venus: ${b.flybyFlux.toFixed(1)}x sunlight vs ${P.thermal.hotLimit}x limit.`);
    }
    if (tr.flyby === 'jupiter' && b.flybyMargin < 0) {
      fail(tr.flybyYear, 'cruise', 'flyby', `Jupiter flyby radiation: ${Math.round(b.flybyDose)} krad vs ${P.thermal.radTol} krad tolerance.`);
    }
  }
  if (opts.event) events.push({ t: cruise * opts.eventFrac, phase: 'cruise', kind: 'random', text: opts.event.text });
  for (const c of b.lifeChecks) {
    if (c.part.life < c.need) {
      const phase = c.part.life < cruise ? 'cruise' : 'ops';
      fail(c.part.life, phase, 'life', `${c.part.name} reached its ${c.part.life}-year design life and failed.`, { lifePart: c });
    }
  }
  // Radiation: dose accumulates linearly, plus flyby spike
  const tol = P.thermal.radTol;
  if (doseAt(end, b) > tol && !(tr.flyby === 'jupiter' && b.flybyMargin < 0)) {
    const t = findFirst(0, end, (x) => doseAt(x, b) > tol);
    fail(t, t < cruise ? 'cruise' : 'ops', 'radiation', `Radiation dose hit ${Math.round(doseAt(end, b))} krad vs ${tol} krad tolerance.`);
  }

  // Arrival burn
  events.push({ t: cruise, phase: 'arrival', kind: 'arrival', text: 'Arrival burn' });
  if (P.engine.lowThrust && b.ionMargin < 0) {
    fail(cruise, 'arrival', 'insertion', `Ion engine starved: needs ${Math.round(b.ionLoad)} W, power system gives ${Math.round(b.supplyArrive)} W.`, { ion: true });
  }
  if (b.dvAvail < b.dvReq) {
    fail(cruise, 'arrival', 'insertion', `Missed orbit insertion: short by ${Math.round(b.dvReq - b.dvAvail)} m/s.`);
  }

  // Operations
  if (b.hotFlux > b.hotLimit) fail(cruise + 0.01, 'ops', 'overheat', `Overheated: ${b.hotFlux.toFixed(1)}x sunlight vs ${b.hotLimit}x limit.`);
  const mainShort = (t) => supplyAt(t, P, cruise, opts, tr.flyby ? FLYBYS[tr.flyby].arrayHit : 0) < b.mainLoad;
  const allShort = (t) => supplyAt(t, P, cruise, opts, tr.flyby ? FLYBYS[tr.flyby].arrayHit : 0) < b.load;
  if (mainShort(end)) {
    const t = findFirst(cruise, end, mainShort);
    const s = supplyAt(t, P, cruise, opts, tr.flyby ? FLYBYS[tr.flyby].arrayHit : 0);
    fail(t, 'ops', 'brownout', `Brownout: load ${Math.round(b.mainLoad)} W, power ${Math.round(s)} W.`, { supply: s });
  } else if (allShort(end)) {
    const t = findFirst(cruise, end, allShort);
    fail(t, 'ops', 'freeze', `Froze: no power left for ${Math.round(b.heater)} W of heaters.`, { supply: supplyAt(t, P, cruise, opts, tr.flyby ? FLYBYS[tr.flyby].arrayHit : 0) });
  }
  if (D.id === 'moon') {
    events.push({ t: cruise + 0.04, phase: 'ops', kind: 'hazard', text: 'Lunar night' });
    if (b.hazardMargin < 0) fail(cruise + 0.04, 'ops', 'night', `Lunar night: needed ${(b.nightNeedWh / 1000).toFixed(1)} kWh, battery holds ${(b.batteryWh / 1000).toFixed(1)} kWh.`);
  }
  if (D.id === 'mars') {
    events.push({ t: cruise + D.stormYear, phase: 'ops', kind: 'hazard', text: 'Global dust storm' });
    if (b.hazardMargin < 0) fail(cruise + D.stormYear, 'ops', 'storm', `Dust storm: arrays gave ${Math.round(b.stormSupply)} W, survival needs ${Math.round(b.stormLoad)} W.`);
  }
  if (D.id === 'europa') events.push({ t: cruise + 0.1, phase: 'ops', kind: 'hazard', text: 'Radiation belts' });
  if (D.id === 'mercury') events.push({ t: cruise + 0.01, phase: 'ops', kind: 'hazard', text: '10x sunlight' });
  if (D.id === 'pluto') events.push({ t: cruise + 0.05, phase: 'ops', kind: 'hazard', text: 'Faint signal' });

  fails.sort((a, b2) => a.t - b2.t);
  return finish(b, opts, events, fails[0] || null);
}

function hazardMode(D) {
  return { mercury: 'overheat', moon: 'night', mars: 'storm', europa: 'radiation', pluto: 'data' }[D.id];
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
  if (!failure && scienceGb >= D.fullGb) outcome = 'full';
  if (!failure && outcome === 'min') {
    failure = { t: end, phase: 'ops', mode: 'data', hazard: D.id === 'pluto', text: `Data shortfall: returned ${fmtGb(scienceGb)} of ${D.fullGb} Gbit goal (${Math.round(100 * scienceGb / D.fullGb)}%).`, partial: true };
  }
  const points = Math.round(100 * Math.min(1.5, scienceGb / D.fullGb));
  const score = Math.round(points * D.mult);
  return { b, opts, events: events.sort((x, y) => x.t - y.t), failure, outcome, scienceGb, points, score, cost: b.cost, opsTime };
}

function pctSun(D) {
  const p = 100 * Math.min(D.solarCap, 1 / D.sunAU ** 2);
  return p >= 10 ? `${Math.round(p)}%` : p >= 1 ? `${p.toFixed(1)}%` : `${p.toFixed(2)}%`;
}

export function fmtGb(x) {
  if (x >= 100) return `${Math.round(x)} Gbit`;
  if (x >= 10) return `${x.toFixed(0)} Gbit`;
  return `${x.toFixed(1)} Gbit`;
}

// ---------- root-cause chains for the anomaly report ----------
// Each chain is a list of short steps that read left to right with arrows.
export function explain(d, res) {
  const f = res.failure; if (!f) return [];
  const b = res.b; const { P, D, tr } = b;
  const trLabel = d.traj === 'assist' ? `Assist (${tr.label})` : 'Direct trajectory';
  const growthPct = Math.round((res.opts.growth || 0) * 100);
  const chains = [];
  const est = budgets(d, ESTIMATE);
  const heavy = massDrivers(d).slice(0, 2).map((x) => `${x.part.name} (+${x.extra} kg vs lightest)`);

  switch (f.mode) {
    case 'cost': {
      const c = [`Parts $${Math.round(b.partCost)}M`, `${P.launcher.name} $${b.launchCost}M`, `${trLabel} -> ${fmtYr(b.years)} of ops x $${D.opsCostPerYr}M/yr = $${Math.round(b.opsCost)}M`, `Total $${Math.round(b.cost)}M vs budget $${D.budget}M`, `Over by $${Math.round(b.cost - D.budget)}M -> launch blocked`];
      chains.push(c);
      const pricey = costDrivers(d)[0];
      if (pricey) chains.push([`Biggest spend you chose: ${pricey.part.name} ($${pricey.part.cost}M)`, `a cheaper option saves $${pricey.extra}M`]);
      break;
    }
    case 'launcher': {
      const c = [`${trLabel} -> launch energy C3 = ${tr.c3}`, `${P.launcher.name} lifts only ${Math.round(b.cap)} kg at that energy`];
      if (heavy.length) c.push(`Heaviest choices: ${heavy.join(', ')}`);
      c.push(`Dry ${Math.round(b.dry)} kg + propellant ${b.prop} kg = ${Math.round(b.wet)} kg`);
      c.push(`Over by ${Math.round(b.wet - b.cap)} kg -> launcher overload`);
      chains.push(c);
      if (est.wet <= b.cap) chains.push([`On paper it fit (${Math.round(est.wet)} kg)`, `Real hardware came in ${growthPct}% heavier`, 'Zero margin -> overload. Margins matter.']);
      break;
    }
    case 'insertion': {
      if (f.ion) {
        chains.push([`${P.engine.name} needs ${P.engine.powerW} W to thrust`, `${P.power.name} gives ${Math.round(b.supplyArrive)} W at ${D.name}`, `Short by ${Math.round(b.ionLoad - b.supplyArrive)} W -> engine can't fire -> missed orbit insertion`]);
        break;
      }
      const c = [];
      if (heavy.length) c.push(`${heavy.join(' + ')}`);
      if (P.payload.powerW >= 100 && P.power.type === 'solar') c.push(`${P.payload.name} draws ${P.payload.powerW} W -> needs ${P.power.name}`);
      c.push(`Dry mass ${Math.round(b.dry)} kg (incl. ${Math.round(b.structure * (1 + res.opts.growth))} kg structure)`);
      c.push(`${P.tank.name} ${b.prop} kg + ${P.engine.name} (Isp ${P.engine.isp} s) -> ${Math.round(b.dvAvail)} m/s`);
      if (b.dvPenalty > 1) c.push(`Low thrust: needs ${b.dvPenalty}x more delta-v to capture`);
      c.push(`Needed ${Math.round(b.dvReq)} m/s -> short by ${Math.round(b.dvReq - b.dvAvail)} m/s -> missed orbit insertion`);
      chains.push(c);
      if (P.thermal.id === 'vault') chains.push([`Radiation vault (+${P.thermal.mass} kg)`, '+mass', 'delta-v short']);
      if (est.dvAvail >= est.dvReq) chains.push([`On paper you had ${Math.round(est.dvAvail)} m/s`, `Hardware came in ${growthPct}% heavier`, 'Margin gone. Margins matter.']);
      if (res.opts.event && (res.opts.event.ispFactor || res.opts.event.extraDv)) chains.push([`Bad luck: ${res.opts.event.text}`, 'Small margin could not absorb it']);
      break;
    }
    case 'brownout': {
      const dist = P.power.type === 'solar' ? `${D.name} at ${D.sunAU} AU -> sunlight ${pctSun(D)} of Earth's` : `RTG decays ${(P.power.decay * 100).toFixed(1)}%/yr`;
      chains.push([
        `Load: bus ${BUS.powerW} W + ${P.payload.name} ${P.payload.powerW} W + ${P.comms.name} ${P.comms.powerW} W = ${Math.round(b.mainLoad)} W`,
        `${P.power.name}: ${P.power.outW} W at Earth`, dist,
        `Year ${fmtYr(f.t, true)} -> only ${Math.round(f.supply)} W`, `Short by ${Math.round(b.mainLoad - f.supply)} W -> brownout`,
      ]);
      if (P.engine.lowThrust) chains.push(['Ion engine chosen', 'needed power', 'power system sized too small for science too']);
      break;
    }
    case 'freeze': {
      chains.push([
        `${D.name} is cold -> ${P.thermal.name} needs ${Math.round(b.heater)} W of heaters`,
        `Heater added to load -> ${Math.round(b.load)} W total`,
        `${P.power.name} gives ${Math.round(f.supply)} W here (year ${fmtYr(f.t, true)})`,
        'Heaters starved -> froze',
      ]);
      if (P.power.type !== 'rtg') chains.push(['An RTG\'s waste heat would have kept you warm', 'but it costs mass and money']);
      break;
    }
    case 'overheat': {
      const c = [`${D.name}: ${D.hotFlux}x Earth sunlight`];
      if (P.power.type === 'rtg') c.push(`RTG adds its own waste heat (+${RTG_HOT_FLUX}x)`);
      c.push(`${P.thermal.name} can reject ${P.thermal.hotLimit}x`, 'Overheated on arrival');
      chains.push(c);
      break;
    }
    case 'flyby': {
      if (tr.flyby === 'venus') {
        const c = [`${trLabel} -> pass Venus at 0.7 AU`, `Sunlight ${FLYBYS.venus.flux}x Earth`];
        if (P.power.type === 'rtg') c.push(`+ RTG waste heat ${RTG_HOT_FLUX}x`);
        c.push(`${P.thermal.name} limit ${P.thermal.hotLimit}x -> overheated in year ${fmtYr(tr.flybyYear, true)}`);
        chains.push(c);
      } else {
        chains.push([`${trLabel} -> pass close to Jupiter`, `+${FLYBYS.jupiter.dose} krad in one day`, `${P.thermal.name} tolerates ${P.thermal.radTol} krad`, `Total ${Math.round(b.flybyDose)} krad -> electronics fried at Jupiter`]);
      }
      break;
    }
    case 'radiation': {
      const c = [];
      if (tr.flyby === 'jupiter') c.push(`Jupiter flyby +${FLYBYS.jupiter.dose} krad`);
      c.push(`${fmtYr(b.cruise)} cruise x ${D.cruiseDosePerYr} krad/yr`);
      if (D.opsDosePerYr > 5) c.push(`${D.name} operations ${D.opsDosePerYr} krad/yr`);
      if (res.opts.event && res.opts.event.dose) c.push(`Solar flare +${res.opts.event.dose} krad`);
      c.push(`${P.thermal.name} tolerates ${P.thermal.radTol} krad`, `Failed in year ${fmtYr(f.t, true)}`);
      chains.push(c);
      if (P.thermal.id !== 'vault') chains.push(['Shielding (vault) would add mass', 'mass costs delta-v and launcher size', 'that is the trade']);
      break;
    }
    case 'life': {
      const c = f.lifePart;
      const steps = [];
      if (d.traj === 'assist') {
        const dir = budgets({ ...d, traj: 'direct' }, ESTIMATE);
        steps.push(`Assist chosen`);
        if (dir.cap != null && dir.massMargin < 0) steps.push(`(Direct would overload the ${P.launcher.name})`);
        else steps.push('launcher kept small (saved $)');
      } else steps.push('Direct trajectory');
      steps.push(`${fmtYr(c.need)} ${c.key === 'engine' ? 'until arrival burn' : 'mission'}`);
      steps.push(`${c.part.name} design life ${c.part.life} yr`);
      steps.push(`Failed in year ${Math.ceil(c.part.life + 0.001)}`);
      chains.push(steps);
      break;
    }
    case 'night': {
      chains.push([
        'Lunar night: 14 days, no sun',
        `Survival load: bus ${BUS.survivalW} W + heaters ${Math.round(b.nightLoad - BUS.survivalW)} W (${P.thermal.name})`,
        `x 336 h = ${(b.nightNeedWh / 1000).toFixed(1)} kWh`,
        `${P.power.name} battery holds ${(b.batteryWh / 1000).toFixed(1)} kWh`,
        'Battery dead -> froze on night 1',
      ]);
      break;
    }
    case 'storm': {
      chains.push([
        'Global dust storm: sunlight -80%',
        `${P.power.name} drops to ${Math.round(b.stormSupply)} W`,
        `Survival needs bus ${BUS.survivalW} W + heaters ${Math.round(b.heater)} W = ${Math.round(b.stormLoad)} W`,
        'Brownout during the storm',
      ]);
      break;
    }
    case 'data': {
      const genLimited = b.genPerYr <= b.downPerYr;
      if (genLimited) {
        chains.push([`${P.payload.name} makes only ${fmtGb(b.genPerYr)}/yr`, `${fmtYr(res.opsTime)} of operations`, `Returned ${fmtGb(res.scienceGb)} of ${D.fullGb} Gbit goal`]);
      } else {
        chains.push([
          `${P.payload.name} makes ${fmtGb(b.genPerYr)}/yr`,
          `${P.comms.name} at ${D.earthAU} AU from Earth downlinks ${fmtGb(b.downPerYr)}/yr`,
          'Data piles up onboard',
          `Only ${Math.round(100 * Math.min(b.downPerYr, b.genPerYr) * D.opsYears / D.fullGb)}% of goal returned`,
        ]);
      }
      break;
    }
    default: break;
  }
  return chains;
}

// Which choices added the most mass vs the lightest option in their slot.
export function massDrivers(d) {
  const out = [];
  for (const s of SLOTS) {
    if (!s.list[0] || s.list[0].mass == null) continue;
    const p = s.list.find((x) => x.id === d[s.key]); if (!p) continue;
    const min = Math.min(...s.list.map((x) => x.mass));
    if (p.mass - min > 0) out.push({ slot: s, part: p, extra: p.mass - min });
  }
  return out.sort((a, b) => b.extra - a.extra);
}

export function costDrivers(d) {
  const out = [];
  for (const s of SLOTS) {
    if (!s.list[0] || s.list[0].cost == null) continue;
    const p = s.list.find((x) => x.id === d[s.key]); if (!p) continue;
    const min = Math.min(...s.list.map((x) => x.cost));
    if (p.cost - min > 0) out.push({ slot: s, part: p, extra: p.cost - min });
  }
  return out.sort((a, b) => b.extra - a.extra);
}

export function fmtYr(y, bare = false) {
  if (y < 0.1) return bare ? `${Math.max(1, Math.round(y * 365))} days` : `${Math.max(1, Math.round(y * 365))} days`;
  const s = y < 10 ? y.toFixed(1).replace(/\.0$/, '') : Math.round(y).toString();
  return bare ? s : `${s} yr`;
}

// Short code to call out for the whiteboard: destination + 4 characters.
export function teamCode(d, seed, attempt) {
  const s = SLOTS.map((x) => x.list.findIndex((p) => p.id === d[x.key])).join('') + d.dest + seed + attempt;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) { code += alphabet[(h >>> (i * 5)) & 31]; }
  return `${byId(DESTINATIONS, d.dest).code}-${code}`;
}

// Every possible design for one destination (used by balance + debug).
export function* allDesigns(dest) {
  for (const payload of PAYLOADS) for (const power of POWER) for (const thermal of THERMAL)
    for (const comms of COMMS) for (const engine of ENGINES) for (const tank of TANKS)
      for (const launcher of LAUNCHERS) for (const traj of TRAJECTORIES) {
        yield { dest, payload: payload.id, power: power.id, thermal: thermal.id, comms: comms.id, engine: engine.id, tank: tank.id, launcher: launcher.id, traj: traj.id };
      }
}

export function cheapestFull(dest, opts = NOMINAL) {
  let best = null;
  for (const d of allDesigns(dest)) {
    const r = simulate(d, opts);
    if (r.outcome === 'full' && (!best || r.cost < best.cost)) best = { d, cost: r.cost, r };
  }
  return best;
}
