// All tunable numbers for Mission Design live in this file.
// Units: mass kg, power W, cost $M, data Gbit, delta-v m/s, time years,
// radiation krad, C3 (launch energy) km^2/s^2, solar flux in multiples of Earth's.

export const G0 = 9.81;

// Structure, wiring, and brackets are a fixed fraction of everything else.
export const STRUCTURE_FRACTION = 0.25;

// Hidden mass growth applied at launch (seeded, 0..MAX). Never shown before launch.
export const MASS_GROWTH_MAX = 0.15;

// Avionics, computer, reaction wheels: always on board.
export const BUS = { mass: 60, cost: 40, powerW: 60, survivalW: 15 };

// RTG waste heat: warms the craft (cuts heater power) but adds heat in hot places.
export const RTG_HEATER_CREDIT_W = 100;
export const RTG_HOT_FLUX = 0.8;

// Margin thresholds for the design review (fraction of limit).
export const MARGIN_GREEN = 0.15;

// Minimum time operating at the destination to count as "arrived and operating".
export const MIN_OPS_YEARS = 0.02;

export const FLYBYS = {
  venus: { name: 'Venus flyby', flux: 1.9, arrayHit: 0.05, dose: 0 },
  jupiter: { name: 'Jupiter flyby', flux: 0.04, arrayHit: 0, dose: 45 },
};

export const DESTINATIONS = [
  {
    id: 'mercury', name: 'Mercury', code: 'MER', color: '#b5a48f',
    goal: 'Orbit Mercury and map the surface.',
    dvLabel: 'Extreme', thermalLabel: 'Extreme heat', difficulty: 5, mult: 2.5,
    hazard: { name: 'Sun at 10x', text: '10x sunlight cooks solar arrays and needs big radiators.' },
    sunAU: 0.39, solarCap: 2.0, solarDeg: 0.07, earthAU: 1.0, contact: 0.33,
    hotFlux: 10, coldW: 0,
    cruiseDosePerYr: 2, opsDosePerYr: 15,
    opsYears: 2, opsCostPerYr: 22, budget: 680,
    fullGb: 200, lowThrustPenalty: 1.1,
    minGoal: 'Reach Mercury orbit and start operating.',
    fullGoal: 'Return 200 Gbit of science.',
    traj: {
      direct: { label: 'Direct', c3: 35, dv: 2300, cruise: 1.0 },
      assist: { label: 'Venus flybys', c3: 16, dv: 1600, cruise: 6.5, flyby: 'venus', flybyYear: 2 },
    },
  },
  {
    id: 'moon', name: 'Moon', code: 'MOO', color: '#c9c9c9',
    goal: 'Land near the south pole and run a year of science.',
    dvLabel: 'Easy', thermalLabel: 'Extreme swings', difficulty: 3, mult: 1.3,
    hazard: { name: 'Lunar night', text: '14 days of dark and -170 C. No sun: batteries and heaters must carry you.' },
    sunAU: 1.0, solarCap: 1.0, solarDeg: 0.02, earthAU: 0.05, contact: 0.5,
    hotFlux: 2.2, coldW: 60, nightHours: 336,
    cruiseDosePerYr: 3, opsDosePerYr: 8,
    opsYears: 1, opsCostPerYr: 15, budget: 460,
    fullGb: 300, lowThrustPenalty: 99,
    minGoal: 'Land and start operating.',
    fullGoal: 'Survive every lunar night and return 300 Gbit.',
    traj: {
      direct: { label: 'Direct', c3: -2, dv: 1800, cruise: 0.02 },
      assist: { label: 'Low-energy ballistic transfer', c3: -1, dv: 1500, cruise: 0.3 },
    },
  },
  {
    id: 'mars', name: 'Mars', code: 'MAR', color: '#c1440e',
    goal: 'Land a science station on Mars.',
    dvLabel: 'Easy', thermalLabel: 'Mild', difficulty: 1, mult: 1.0,
    hazard: { name: 'Dust storm', text: 'A global dust storm cuts sunlight by 80% for weeks.' },
    sunAU: 1.52, solarCap: 1.0, solarDeg: 0.02, earthAU: 1.5, contact: 0.33,
    hotFlux: 0.43, coldW: 45, stormFactor: 0.2, stormYear: 0.6,
    cruiseDosePerYr: 3, opsDosePerYr: 5,
    opsYears: 2, opsCostPerYr: 18, budget: 420,
    fullGb: 150, lowThrustPenalty: 1.6,
    minGoal: 'Land and start operating.',
    fullGoal: 'Ride out the dust storm and return 150 Gbit.',
    traj: {
      direct: { label: 'Direct', c3: 14, dv: 1650, cruise: 0.7 },
      assist: { label: 'Earth flyby', c3: 6, dv: 1400, cruise: 2.0 },
    },
  },
  {
    id: 'europa', name: 'Europa', code: 'EUR', color: '#d8c7a3',
    goal: 'Orbit Jupiter and fly past Europa dozens of times.',
    dvLabel: 'Moderate', thermalLabel: 'Cold', difficulty: 4, mult: 1.8,
    hazard: { name: 'Jupiter radiation', text: 'Jupiter\'s radiation belts fry unshielded electronics.' },
    sunAU: 5.2, solarCap: 1.0, solarDeg: 0.04, earthAU: 5.2, contact: 0.33,
    hotFlux: 0.04, coldW: 60,
    cruiseDosePerYr: 2, opsDosePerYr: 35,
    opsYears: 2, opsCostPerYr: 25, budget: 760,
    fullGb: 90, lowThrustPenalty: 1.3,
    minGoal: 'Enter Jupiter orbit and start Europa flybys.',
    fullGoal: 'Return 90 Gbit before radiation wins.',
    traj: {
      direct: { label: 'Direct', c3: 45, dv: 1400, cruise: 3.0 },
      assist: { label: 'Mars + Earth flybys', c3: 24, dv: 1200, cruise: 6.0 },
    },
  },
  {
    id: 'pluto', name: 'Pluto', code: 'PLU', color: '#d9b38c',
    goal: 'Fly past Pluto and send the pictures home.',
    dvLabel: 'Extreme', thermalLabel: 'Deep cold', difficulty: 5, mult: 2.5,
    hazard: { name: 'Faint signal', text: 'At 33 AU the radio signal is a trickle, and the trip takes about a decade.' },
    sunAU: 33, solarCap: 1.0, solarDeg: 0.02, earthAU: 33, contact: 0.5,
    hotFlux: 0.001, coldW: 110,
    cruiseDosePerYr: 1.5, opsDosePerYr: 1,
    opsYears: 1, opsCostPerYr: 18, budget: 800,
    fullGb: 1.6, lowThrustPenalty: 1.0,
    minGoal: 'Reach Pluto and take data.',
    fullGoal: 'Downlink 1.6 Gbit of Pluto science.',
    traj: {
      direct: { label: 'Direct', c3: 60, dv: 600, cruise: 8.0 },
      assist: { label: 'Jupiter flyby', c3: 40, dv: 450, cruise: 9.5, flyby: 'jupiter', flybyYear: 1.1 },
    },
  },
];

// ---------- Parts ----------
// Every part has: id, name, role, blurb, mass, cost, life (design life, years).

export const PAYLOADS = [
  { id: 'cam', name: 'Survey', blurb: 'Survey camera. Wide views, low data.', mass: 20, cost: 25, powerW: 25, genGb: 80, life: 15 },
  { id: 'spec', name: 'Spectrometry', blurb: 'Spectrometer suite. What it is made of.', mass: 55, cost: 60, powerW: 60, genGb: 400, life: 11 },
  { id: 'hires', name: 'Imaging + radar', blurb: 'Hi-res imager and radar. Huge data, heavy, hungry.', mass: 140, cost: 110, powerW: 150, genGb: 3000, life: 10 },
];

export const POWER = [
  { id: 'ssolar', name: 'Small solar arrays', blurb: 'Light and cheap. Weak far from the Sun.', type: 'solar', mass: 30, cost: 15, outW: 600, batteryWh: 4000, life: 9 },
  { id: 'lsolar', name: 'Large solar arrays', blurb: 'Lots of power near the Sun. Big battery.', type: 'solar', mass: 95, cost: 40, outW: 6000, batteryWh: 22000, life: 12 },
  { id: 'rtg', name: 'RTG (nuclear)', blurb: 'Steady power anywhere. Heavy, pricey, warm.', type: 'rtg', mass: 110, cost: 120, outW: 300, decay: 0.015, batteryWh: 1500, life: 20 },
];

export const THERMAL = [
  { id: 'mli', name: 'Light blankets', blurb: 'Basic insulation. Light.', mass: 12, cost: 8, hotLimit: 2.5, heaterFactor: 1.0, radTol: 30, life: 15 },
  { id: 'rad', name: 'Radiators + louvers', blurb: 'Dumps heat. Handles fierce sun.', mass: 40, cost: 22, hotLimit: 11, heaterFactor: 0.8, radTol: 90, life: 10.5 },
  { id: 'vault', name: 'Radiation vault', blurb: 'Shielded box + thick insulation.', mass: 75, cost: 30, hotLimit: 3, heaterFactor: 0.5, radTol: 300, life: 15 },
];

export const COMMS = [
  { id: 'lga', name: 'Low-gain antenna', blurb: 'Tiny and tough. Slow.', mass: 4, cost: 5, powerW: 10, rateGb: 400, life: 20 },
  { id: 'mga', name: 'Medium dish (1 m)', blurb: '10x faster.', mass: 15, cost: 15, powerW: 30, rateGb: 4000, life: 15 },
  { id: 'hga', name: 'High-gain dish (3 m)', blurb: '100x faster. Heavy, needs pointing.', mass: 40, cost: 35, powerW: 60, rateGb: 40000, life: 12 },
];

export const ENGINES = [
  { id: 'mono', name: 'Monoprop thrusters', blurb: 'Simple and light. Low efficiency.', mass: 12, cost: 8, isp: 225, thrustN: 100, life: 15 },
  { id: 'biprop', name: 'Biprop main engine', blurb: 'Strong and efficient.', mass: 35, cost: 22, isp: 320, thrustN: 450, life: 12 },
  { id: 'ion', name: 'Ion engine', blurb: '10x efficiency, tiny thrust. Needs 600 W.', mass: 70, cost: 50, isp: 3000, thrustN: 0.2, lowThrust: true, powerW: 600, life: 6 },
];

export const TANKS = [
  { id: 'stank', name: 'Small tank', blurb: '150 kg propellant.', mass: 15, cost: 5, prop: 150, life: 30 },
  { id: 'mtank', name: 'Medium tank', blurb: '450 kg propellant.', mass: 35, cost: 10, prop: 450, life: 30 },
  { id: 'ltank', name: 'Large tank', blurb: '1100 kg propellant.', mass: 80, cost: 18, prop: 1100, life: 30 },
];

// Capacity to a given launch energy: cap = baseKg * exp(-c3 / falloff)
export const LAUNCHERS = [
  { id: 'light', name: 'Light launcher', blurb: 'Cheap. Small payloads.', cost: 60, baseKg: 2400, falloff: 35 },
  { id: 'medium', name: 'Medium launcher', blurb: 'The workhorse.', cost: 130, baseKg: 5000, falloff: 50 },
  { id: 'heavy', name: 'Heavy launcher', blurb: 'Huge energy. Huge price.', cost: 250, baseKg: 11000, falloff: 55 },
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

// The part slots in build order, with the role that owns each one.
export const SLOTS = [
  { key: 'payload', label: 'Mission', role: 'Science', list: PAYLOADS, screen: 2 },
  { key: 'power', label: 'Power system', role: 'Power & Thermal', list: POWER, screen: 3 },
  { key: 'thermal', label: 'Thermal / protection', role: 'Power & Thermal', list: THERMAL, screen: 3 },
  { key: 'comms', label: 'Antenna', role: 'Comms & Data', list: COMMS, screen: 3 },
  { key: 'engine', label: 'Engine', role: 'Propulsion', list: ENGINES, screen: 3 },
  { key: 'tank', label: 'Propellant tank', role: 'Propulsion', list: TANKS, screen: 3 },
  { key: 'launcher', label: 'Launcher', role: 'Systems', list: LAUNCHERS, screen: 4 },
  { key: 'traj', label: 'Trajectory', role: 'Systems', list: TRAJECTORIES, screen: 4 },
];
