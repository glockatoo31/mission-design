// All tunable numbers for Mission Design live in this file.
// Units: mass kg, power W, cost $M, data Gbit, delta-v m/s, time years, area m^2,
// radiation krad, C3 (launch energy) km^2/s^2, solar flux in multiples of Earth's.

import { COMMS_PARTS, POWER_PARTS, THERMAL_PARTS, ENGINES, TANKS, LAUNCHERS } from './parts.js';
export { ENGINES, LAUNCHERS, TANKS, COMMS_PARTS, POWER_PARTS, THERMAL_PARTS };

export const G0 = 9.81;

// Structure, wiring, and brackets are a fixed fraction of everything else.
export const STRUCTURE_FRACTION = 0.25;

// Hidden mass growth applied at launch (seeded, 0..MAX). Never shown before launch.


// Avionics, computer, reaction wheels: always on board.
export const BUS = { mass: 60, cost: 40, powerW: 60, survivalW: 15 };

// A battery may be discharged to 80% at most, and the deeper it is cycled the sooner it wears out:
// cycle life = baseCycles x (refDod / depth)^exponent, kept between minCycles and maxCycles.
export const BATTERY_LIFE = { dodMax: 0.8, baseCycles: 2500, refDod: 0.4, exponent: 1.3, minCycles: 200, maxCycles: 8000 };

// Every arrival burn carries a trajectory-correction allowance: a fixed amount plus a fraction of the burn.
export const TCM = { base: 30, frac: 0.05 };

// RTG waste heat, per unit: warms the craft (cuts heater power) but adds heat in hot places.



// Margin thresholds for the design review (fraction of limit).
export const MARGIN_GREEN = 0.15;

// Minimum time operating at the destination to count as "arrived and operating".
export const MIN_OPS_YEARS = 0.02;

export const FLYBYS = {
  venus: { name: 'Venus flyby', flux: 1.9, arrayHit: 0.05, dose: 0 },
  jupiter: { name: 'Jupiter flyby', flux: 0.04, arrayHit: 0, dose: 45 },
};

// ---------- Procedural parts ----------
// Each slider part is a formula: set a size, get mass, cost, and performance.
export const SOLAR = { wPerM2: 150, massBase: 8, massPerM2: 2.3, costBase: 6, costPerM2: 0.9, life: 12 };
export const RTG = { unitW: 300, mass: 110, cost: 120, decay: 0.015, life: 20 };
export const BATTERY = { massBase: 5, massPerKWh: 4, costBase: 0.5, costPerKWh: 0.8, defaultKWh: 2 };
// Radiator area raises the heat limit but leaks heat in the cold (more heater power);
// shielding raises radiation tolerance and insulates (less heater power).
export const THERMAL = {
  massBase: 12, massPerRad: 3.5, massPerShield: 6.3, costBase: 8, costPerRad: 1.75, costPerShield: 2.2,
  hotBase: 2.5, hotPerRad: 1.1, radTolBase: 30, radTolPerShield: 27,
  heaterBase: 1, heaterPerShield: 0.05, heaterPerRad: 0.12, heaterMin: 0.4, life: 15, lifePerRad: 0.55,
};
// Downlink rate grows with dish area and transmitter (RF) power. The amplifier is 33% efficient:
// each RF watt draws 3 W from the bus and adds amplifier mass, cost, and waste heat (x sun).
export const COMMS = {
  rateK: 133, massBase: 3, massPerD2: 4, costBase: 5, costPerD2: 3.3, lifeBase: 20, lifePerD: 2.7,
  drawPerTxW: 3, massPerTxW: 0.15, costPerTxW: 0.15, heatPerTxW: 0.015,
};
export const TANK = { massBase: 5, massPerKg: 0.068, costBase: 3, costPerKg: 0.015, life: 30 };

// Slider definitions: range, step, default, and what the screen calls them.
export const PARAMS = {
  solarArea: { label: 'Solar array area', unit: 'm²', min: 0, max: 40, step: 0.5, def: 8 },
  rtgUnits: { label: 'RTG units', unit: '', min: 0, max: 3, step: 1, def: 0 },
  battery: { label: 'Battery', unit: 'kWh', min: 1, max: 30, step: 1, def: 6 },
  radiator: { label: 'Radiator area', unit: 'm²', min: 0, max: 8, step: 0.5, def: 2 },
  shield: { label: 'Radiation shielding', unit: 'cm', min: 0, max: 10, step: 0.5, def: 2 },
  dish: { label: 'Dish diameter', unit: 'm', min: 0.3, max: 3.5, step: 0.1, def: 1 },
  txPower: { label: 'Transmitter radio power', unit: 'W', min: 10, max: 100, step: 5, def: 30 },
  fuel: { label: 'Fuel', unit: 'kg', min: 50, max: 1500, step: 10, def: 400 },
};

export const DESTINATIONS = [
  {
    id: 'mercury', name: 'Mercury', code: 'MER', color: '#b5a48f',
    dvLabel: 'Extreme', thermalLabel: 'Extreme heat', difficulty: 5, mult: 2.5,
    hazard: { name: 'Sun at 10x', text: '10x sunlight cooks solar arrays and needs big radiators.' },
    sunAU: 0.39, solarCap: 2.0, solarDeg: 0.07, earthAU: 1.0, contact: 0.33,
    hotFlux: 10, coldW: 0, dark: { hours: 1, cyclesPerYr: 730, ops: 1, label: 'Eclipse' },
    cruiseDosePerYr: 2, opsDosePerYr: 15,
    opsYears: 2, opsCostPerYr: 7, lowThrustPenalty: 1.1,
    traj: {
      direct: { label: 'Direct', c3: 35, dv: 2300, cruise: 1.0 },
      assist: { label: 'Venus flybys', c3: 16, dv: 1600, cruise: 6.5, flyby: 'venus', flybyYear: 2 },
    },
  },
  {
    id: 'moon', name: 'Moon', code: 'MOO', color: '#c9c9c9',
    dvLabel: 'Easy', thermalLabel: 'Extreme swings', difficulty: 3, mult: 1.3,
    hazard: { name: 'Lunar night', text: '14 days of dark and -170 C. No sun: batteries and heaters must carry you.' },
    sunAU: 1.0, solarCap: 1.0, solarDeg: 0.02, earthAU: 0.05, contact: 0.5,
    hotFlux: 2.2, coldW: 60, dark: { hours: 336, cyclesPerYr: 12.4, ops: 0, label: 'Lunar night' },
    cruiseDosePerYr: 3, opsDosePerYr: 8,
    opsYears: 1, opsCostPerYr: 15, lowThrustPenalty: 99,
    traj: {
      direct: { label: 'Direct', c3: -2, dv: 1800, cruise: 0.02 },
      assist: { label: 'Low-energy ballistic transfer', c3: -1, dv: 1500, cruise: 0.3 },
    },
  },
  {
    id: 'mars', name: 'Mars', code: 'MAR', color: '#c1440e',
    dvLabel: 'Easy', thermalLabel: 'Mild', difficulty: 1, mult: 1.0,
    hazard: { name: 'Dust storm', text: 'A global dust storm cuts sunlight by 80% for weeks.' },
    sunAU: 1.52, solarCap: 1.0, solarDeg: 0.02, earthAU: 1.5, contact: 0.33,
    hotFlux: 0.43, coldW: 45, stormFactor: 0.1, stormYear: 0.6, dark: { hours: 12.3, cyclesPerYr: 355, ops: 0.3, label: 'Martian night' },
    cruiseDosePerYr: 3, opsDosePerYr: 5,
    opsYears: 2, opsCostPerYr: 18, lowThrustPenalty: 1.6,
    traj: {
      direct: { label: 'Direct', c3: 14, dv: 1650, cruise: 0.7 },
      assist: { label: 'Earth flyby', c3: 6, dv: 1400, cruise: 2.0 },
    },
  },
  {
    id: 'europa', name: 'Europa', code: 'EUR', color: '#d8c7a3',
    dvLabel: 'Moderate', thermalLabel: 'Cold', difficulty: 4, mult: 1.8,
    hazard: { name: 'Jupiter radiation', text: 'Jupiter\'s radiation belts fry unshielded electronics.' },
    sunAU: 5.2, solarCap: 1.0, solarDeg: 0.04, earthAU: 5.2, contact: 0.33,
    hotFlux: 0.04, coldW: 60,
    cruiseDosePerYr: 2, opsDosePerYr: 35,
    opsYears: 2, opsCostPerYr: 25, lowThrustPenalty: 1.3,
    traj: {
      direct: { label: 'Direct', c3: 45, dv: 1400, cruise: 3.0 },
      assist: { label: 'Mars + Earth flybys', c3: 24, dv: 1200, cruise: 6.0 },
    },
  },
  {
    id: 'pluto', name: 'Pluto', code: 'PLU', color: '#d9b38c',
    dvLabel: 'Extreme', thermalLabel: 'Deep cold', difficulty: 5, mult: 2.5,
    hazard: { name: 'Faint signal', text: 'At 33 AU the radio signal is a trickle, and the trip takes about a decade.' },
    sunAU: 33, solarCap: 1.0, solarDeg: 0.02, earthAU: 33, contact: 0.5,
    hotFlux: 0.001, coldW: 110,
    cruiseDosePerYr: 1.5, opsDosePerYr: 1,
    opsYears: 1, opsCostPerYr: 18, lowThrustPenalty: 1.0,
    traj: {
      direct: { label: 'Direct', c3: 85, dv: 600, cruise: 8.0 },
      assist: { label: 'Jupiter flyby', c3: 60, dv: 450, cruise: 9.5, flyby: 'jupiter', flybyYear: 1.1 },
    },
  },
];

// ---------- Fixed instruments (the contract names which one to carry) ----------
export const PAYLOADS = [
  { id: 'cam', name: 'Survey camera', blurb: 'Wide views, low data.', mass: 20, cost: 25, powerW: 25, genGb: 80, life: 15 },
  { id: 'spec', name: 'Spectrometer suite', blurb: 'What the surface is made of.', mass: 55, cost: 60, powerW: 60, genGb: 400, life: 11 },
  { id: 'hires', name: 'Imager + radar', blurb: 'Fine detail, even below the surface.', mass: 140, cost: 110, powerW: 150, genGb: 3000, life: 10 },
];

// ---------- Contracts ----------
// The hard constraints: where, which instrument, how much science, arrive by the deadline
// (years after launch), and the funding cap (the contract ends when the money does).
// The par cost (cheapest full success) is computed live by the solver in model.js. Funding is
// set about 12% above par (npm run balance checks it): a design with a green cost bar is too
// cheap to be robust. `change` is the amendment that lands from round 2: it patches the
// contract and makes the round-1 winner stop winning.
export const CONTRACTS = [
  { id: 'lunar-survey', name: 'Lunar Pathfinder', dest: 'moon', payload: 'cam', goalGb: 70, deadline: 0.25, budget: 350, brief: 'Land near the south pole. Fast and cheap.', change: { patch: { payload: 'hires', goalGb: 300, budget: 445 } }  },
  { id: 'lunar-spec', name: 'South Pole Ice Survey', dest: 'moon', payload: 'cam', goalGb: 75, deadline: 0.5, budget: 344, brief: 'Survive the lunar night and photograph the ice.', change: { patch: { payload: 'hires', goalGb: 900, budget: 445 } } },
  { id: 'mars-survey', name: 'Mars Survey Lander', dest: 'mars', payload: 'cam', goalGb: 150, deadline: 1.5, budget: 250, brief: 'Ride out the dust storm and send pictures home.', change: { patch: { payload: 'spec', goalGb: 225, budget: 295 } } },
  { id: 'mars-radar', name: 'Mars Subsurface Radar', dest: 'mars', payload: 'hires', goalGb: 1500, deadline: 3, budget: 370, brief: 'Radar under the surface. Heavy, hungry, huge data.', change: { patch: { goalGb: 2250, budget: 375 } } },
  { id: 'mercury-survey', name: 'Mercury Surveyor', dest: 'mercury', payload: 'cam', goalGb: 150, deadline: 8, budget: 250, brief: 'Orbit Mercury and map the surface.', change: { patch: { payload: 'spec', goalGb: 450, budget: 305 } } },
  { id: 'europa-spec', name: 'Europa Flyby Spectrometry', dest: 'europa', payload: 'spec', goalGb: 90, deadline: 7, budget: 570, brief: 'Fly past Europa before the radiation wins.', change: { patch: { payload: 'hires', goalGb: 135, budget: 750 } } },
  { id: 'pluto-survey', name: 'Pluto Flyby Imaging', dest: 'pluto', payload: 'cam', goalGb: 1.6, deadline: 10, budget: 585, brief: 'A decade out. Send the pictures home.', change: { patch: { payload: 'spec', goalGb: 4, budget: 630 } } },
  { id: 'pluto-spec', name: 'Pluto Flyby Spectrometry', dest: 'pluto', payload: 'spec', goalGb: 1.6, deadline: 9, budget: 630, brief: 'The same trip, a hungrier instrument, a tighter deadline.', change: { patch: { payload: 'hires', goalGb: 2.4, budget: 885 } } },
];




export const TRAJECTORIES = [
  { id: 'direct', name: 'Direct', blurb: 'Fast. Needs more launch energy.' },
  { id: 'assist', name: 'Assist', blurb: 'Slow. Borrows energy, smaller rocket.' },
];

// One minor random event per launch, picked by the seed.
export const RANDOM_EVENTS = [
  { id: 'isp', text: 'Engine runs 3% below spec.', ispFactor: 0.97 },
  { id: 'flare', text: 'Solar flare during cruise: +8 krad.', dose: 8 },
  { id: 'micromet', text: 'Micrometeoroid hit: -5% power.', powerFactor: 0.95 },
  { id: 'dsn', text: 'Ground station overbooked: -10% contact time.', dataFactor: 0.9 },
  { id: 'dispersion', text: 'Launch slightly off target: +40 m/s to correct.', extraDv: 40 },
  { id: 'calm', text: 'Quiet cruise. Nothing unusual.' },
];

// The parts a team chooses from, per subsystem (the catalogs are in parts.js). Each page sizes the
// chosen part with sliders. Loads come first (antenna, route, engine, fuel), then thermal and power
// are sized to what everyone else asks of them, then the rocket has to lift the result.
export const STEPS = [
  { key: 'comms', label: 'Antenna', role: 'Spacecraft bus', list: COMMS_PARTS },
  { key: 'traj', label: 'Route', role: 'Mission plan', list: TRAJECTORIES },
  { key: 'engine', label: 'Engine', role: 'Propulsion', list: ENGINES },
  { key: 'tank', label: 'Fuel tank', role: 'Propulsion', list: TANKS },
  { key: 'thermal', label: 'Thermal', role: 'Spacecraft bus', list: THERMAL_PARTS },
  { key: 'power', label: 'Power', role: 'Spacecraft bus', list: POWER_PARTS },
  { key: 'launcher', label: 'Rocket', role: 'Launch vehicle', list: LAUNCHERS },
];
