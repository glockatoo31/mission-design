// The parts catalog. Every subsystem offers several real parts; each part has its own character
// and a heritage (how proven it is). A part is chosen, then sized with sliders (dish, array area,
// fuel, radiator, shielding). `def` is the size a part starts at, `range` the sizes it can take.
//
// Heritage sets how much heavier than planned the hardware comes out at launch: a design full of
// flight-proven parts grows little, a design full of new parts can grow a lot.

export const HERITAGE = {
  proven: { label: 'Flight-proven', growth: 0.05 },
  qualified: { label: 'Qualified', growth: 0.12 },
  new: { label: 'New design', growth: 0.25 },
};

// Antennas. rate multiplies the data rate for the same dish and transmitter; mass and cost
// multiply the dish; life adds (or removes) design-life years.
export const COMMS_PARTS = [
  { id: 'patch', name: 'X-band patch antenna', blurb: 'Tiny and tough. A trickle of data.', heritage: 'proven', rate: 1, mass: 0.6, cost: 0.5, life: 4, range: { dish: [0.3, 0.6] }, def: { dish: 0.5, txPower: 20 } },
  { id: 'xdish', name: 'X-band parabolic dish', blurb: 'The deep-space workhorse.', heritage: 'proven', rate: 1, mass: 1, cost: 1, life: 0, range: { dish: [0.6, 3.5] }, def: { dish: 1.2, txPower: 40 } },
  { id: 'mesh', name: 'Deployable mesh dish', blurb: 'Folds up light, but the mesh is delicate and loses some signal.', heritage: 'qualified', rate: 0.8, mass: 0.45, cost: 1.3, life: -4, range: { dish: [1, 3.5] }, def: { dish: 2, txPower: 40 } },
  { id: 'ka', name: 'Ka-band parabolic dish', blurb: 'Three times the data from the same dish. Heavier, pricier, newer to deep space.', heritage: 'qualified', rate: 3, mass: 1.15, cost: 1.5, life: -2, range: { dish: [0.6, 3.5] }, def: { dish: 1.2, txPower: 30 } },
];

// Power sources. Solar parts are sized by array area, RTGs by number of units.
export const POWER_PARTS = [
  { id: 'si', name: 'Silicon solar arrays', blurb: 'Cheap and proven. Heavy, and the cells wear out fast.', kind: 'solar', wPerM2: 110, massBase: 8, massPerM2: 3.2, costBase: 4, costPerM2: 0.5, deg: 2, life: 10, heritage: 'proven', range: { solarArea: [1, 40] }, def: { solarArea: 12, rtgUnits: 0 } },
  { id: 'gaas', name: 'GaAs triple-junction arrays', blurb: 'The standard for spacecraft: good power per square meter.', kind: 'solar', wPerM2: 150, massBase: 8, massPerM2: 2.3, costBase: 6, costPerM2: 0.9, deg: 1, life: 12, heritage: 'proven', range: { solarArea: [1, 40] }, def: { solarArea: 8, rtgUnits: 0 } },
  { id: 'rosa', name: 'Rollout solar arrays (ROSA-style)', blurb: 'Light and powerful, rolled out like a tape measure. Newer.', kind: 'solar', wPerM2: 190, massBase: 8, massPerM2: 1.4, costBase: 8, costPerM2: 1.4, deg: 1, life: 12, heritage: 'qualified', range: { solarArea: [1, 40] }, def: { solarArea: 8, rtgUnits: 0 } },
  { id: 'mmrtg', name: 'MMRTG (Curiosity rover)', blurb: 'A small plutonium generator. Steady and modest, and it fades.', kind: 'rtg', unitW: 110, mass: 45, cost: 55, decay: 0.04, heatW: 60, hotFlux: 0.5, life: 14, heritage: 'proven', range: { rtgUnits: [1, 6] }, def: { solarArea: 0, rtgUnits: 3 } },
  { id: 'gphs', name: 'GPHS-RTG (New Horizons)', blurb: 'A big plutonium generator. Steady anywhere. Heavy, pricey, warm.', kind: 'rtg', unitW: 300, mass: 110, cost: 120, decay: 0.015, heatW: 100, hotFlux: 0.8, life: 20, heritage: 'proven', range: { rtgUnits: [1, 3] }, def: { solarArea: 0, rtgUnits: 1 } },
];

// Thermal and protection. Each part is a profile over the same two sizes (radiator area,
// shielding thickness): cool = heat shed per m2, leak = heat lost in the cold per m2,
// tol = radiation tolerance per cm, and mass and cost multipliers.
export const THERMAL_PARTS = [
  { id: 'mli', name: 'Gold-foil MLI blankets', blurb: 'Light insulation. Barely cools or shields.', massBase: 8, costBase: 5, life: 15, heritage: 'proven', rad: { cool: 0.3, leak: 0, mass: 0.5, cost: 0.5 }, shield: { tol: 0.4, mass: 0.5, cost: 0.4 }, def: { radiator: 1, shield: 1 } },
  { id: 'louver', name: 'Louvers + aluminum radiator panels', blurb: 'Sheds heat. Leaks it in the cold.', massBase: 12, costBase: 8, life: 15, heritage: 'proven', rad: { cool: 1, leak: 1, mass: 1, cost: 1 }, shield: { tol: 1, mass: 1, cost: 1 }, def: { radiator: 5, shield: 2 } },
  { id: 'heatpipe', name: 'Heat pipes + deployable radiator', blurb: 'Moves more heat per panel and leaks less in the cold. Heavier, pricier.', massBase: 14, costBase: 12, life: 15, heritage: 'qualified', rad: { cool: 1.5, leak: 0.4, mass: 1.3, cost: 1.6 }, shield: { tol: 1, mass: 1, cost: 1 }, def: { radiator: 4, shield: 2 } },
  { id: 'tantalum', name: 'Tantalum-lined electronics box', blurb: 'Dense shielding right on the chips: good protection per centimeter.', massBase: 12, costBase: 10, life: 15, heritage: 'qualified', rad: { cool: 1, leak: 1, mass: 1, cost: 1 }, shield: { tol: 1.8, mass: 1.3, cost: 1.9 }, def: { radiator: 2, shield: 4 } },
  { id: 'vault', name: 'Titanium radiation vault (Juno)', blurb: 'A titanium box around the electronics. Blocks radiation and insulates. Heavy.', massBase: 15, costBase: 14, life: 15, heritage: 'proven', rad: { cool: 1, leak: 1, mass: 1, cost: 1 }, shield: { tol: 1.5, mass: 1.1, cost: 1.5 }, def: { radiator: 2, shield: 6 } },
];

// Engines. dvMult is extra burn a part needs (a solid motor cannot be trimmed); lowThrust
// engines need power to run and need more delta-v to capture.
export const ENGINES = [
  { id: 'mono', name: 'Hydrazine thrusters', blurb: 'Simple monopropellant thrusters. Light, low efficiency.', heritage: 'proven', mass: 12, cost: 8, isp: 225, thrustN: 100, life: 15 },
  { id: 'solid', name: 'STAR-class solid rocket motor', blurb: 'Cheap and powerful, but it burns once and cannot be trimmed.', heritage: 'proven', mass: 90, cost: 10, isp: 285, thrustN: 20000, life: 15, dvMult: 1.08 },
  { id: 'biprop', name: 'R-4D-class bipropellant engine', blurb: 'Strong and efficient: the workhorse for orbit insertion.', heritage: 'proven', mass: 35, cost: 22, isp: 320, thrustN: 450, life: 12 },
  { id: 'hall', name: 'Hall thruster (BPT-4000-class)', blurb: 'Five times the efficiency of a chemical engine, gentle thrust, and 900 W to run.', heritage: 'qualified', mass: 55, cost: 38, isp: 1800, thrustN: 0.25, lowThrust: true, powerW: 900, life: 8 },
  { id: 'ion', name: 'Dawn-style ion thruster', blurb: 'Ten times the efficiency, tiny thrust, and 600 W to run.', heritage: 'qualified', mass: 70, cost: 50, isp: 3000, thrustN: 0.2, lowThrust: true, powerW: 600, life: 6 },
];

// Propellant tanks, sized by the fuel slider.
export const TANKS = [
  { id: 'ti', name: 'Titanium propellant tank', blurb: 'Proven, and a bit heavy.', heritage: 'proven', massBase: 5, massPerKg: 0.068, costBase: 3, costPerKg: 0.015, life: 30, def: { fuel: 600 } },
  { id: 'cope', name: 'Composite-overwrapped tank (COPV)', blurb: 'Lighter for the same fuel, but pricier and less proven.', heritage: 'qualified', massBase: 5, massPerKg: 0.045, costBase: 4, costPerKg: 0.03, life: 30, def: { fuel: 600 } },
];

// Capacity to a given launch energy: cap = baseKg * exp(-c3 / falloff)
export const LAUNCHERS = [
  { id: 'light', name: 'Electron-class light launcher', blurb: 'Cheap. Small payloads.', heritage: 'proven', cost: 60, baseKg: 2400, falloff: 35 },
  { id: 'f9', name: 'Falcon 9-class launcher', blurb: 'Reusable-class workhorse. Good value.', heritage: 'proven', cost: 95, baseKg: 3600, falloff: 46 },
  { id: 'medium', name: 'Atlas V-class medium launcher', blurb: 'Reliable and a notch bigger.', heritage: 'proven', cost: 130, baseKg: 5000, falloff: 50 },
  { id: 'heavy', name: 'Falcon Heavy-class heavy launcher', blurb: 'Huge energy. Huge price.', heritage: 'proven', cost: 200, baseKg: 11000, falloff: 55 },
];
