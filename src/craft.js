// The spacecraft, drawn from your design. Every slider changes the picture:
// array area, RTG count, radiators, shielding, dish size, transmitter power, fuel, engine, instrument.
// All coordinates are local to the bus center, 1 m of array or dish is about 20 px.
import { paramVal, parts } from './model.js';

const n1 = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

// Geometry that other drawings (the launch scene's flame) need.
export function craftGeom(d) {
  const fuel = paramVal(d, 'fuel');
  const rt = 4 + 1.4 * Math.cbrt(fuel); // tank radius
  const y0 = 28 + 2 * rt; // top of the engine
  const eng = d.engine;
  const len = eng === 'biprop' ? 16 : eng === 'ion' ? 4 : 7;
  const w = eng === 'biprop' ? 22 : eng === 'ion' ? 22 : 10;
  return { rt, y0, tip: y0 + len, w };
}

// Which parts each screen is about, so they light up while you size them.
export const HIGHLIGHT = {
  power: ['arrays', 'rtg', 'battery'], thermal: ['radiator', 'shield'], comms: ['dish'],
  engine: ['engine'], tank: ['tank'], traj: [], launcher: [],
};

export function craftGroup(d, { hl = [], labels = false } = {}) {
  const A = paramVal(d, 'solarArea'); const n = paramVal(d, 'rtgUnits'); const kWh = paramVal(d, 'battery');
  const Rr = paramVal(d, 'radiator'); const S = paramVal(d, 'shield');
  const dish = paramVal(d, 'dish'); const tx = paramVal(d, 'txPower');
  const P = parts(d);
  const pay = P.payload ? P.payload.id : 'cam';
  const hasNight = !!(P.D && P.D.dark);
  const geo = craftGeom(d);
  const cls = (id, extra = '') => `part ${extra} ${hl.includes(id) ? 'hl' : ''}`.trim();
  const g = []; const lab = [];
  const text = (x, y, anchor, t) => lab.push(`<text x="${x}" y="${y}" class="clabel" text-anchor="${anchor}">${t}</text>`);

  // solar wings, mirrored, hung high on the bus so radiators fit underneath
  if (A > 0) {
    const L = 20 * Math.sqrt(A); const Wd = 10 * Math.sqrt(A); const cy = -14;
    for (const side of [-1, 1]) {
      const x = side > 0 ? 38 : -38 - L; const y = cy - Wd / 2;
      const cols = Math.max(0, Math.floor(L / 14)); const rows = Math.max(0, Math.floor(Wd / 12));
      let grid = '';
      for (let i = 1; i <= cols; i++) grid += `M${(x + (i * L) / (cols + 1)).toFixed(1)} ${y.toFixed(1)}v${Wd.toFixed(1)}`;
      for (let i = 1; i <= rows; i++) grid += `M${x.toFixed(1)} ${(y + (i * Wd) / (rows + 1)).toFixed(1)}h${L.toFixed(1)}`;
      g.push(`<g class="${cls('arrays')}"><line x1="${side * 28}" y1="${cy}" x2="${side * 38}" y2="${cy}" class="strut"/><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${L.toFixed(1)}" height="${Wd.toFixed(1)}" rx="2" class="wing"/><path d="${grid}" class="cells"/></g>`);
    }
    if (labels && hl.includes('arrays')) text((38 + L).toFixed(1), (cy - Wd / 2 - 7).toFixed(1), 'end', `Arrays ${n1(A)} m²`);
  }

  // radiator slats, one stack per side under the wings
  const slats = Math.round(Rr * 1.5);
  if (slats > 0) {
    let s = '';
    for (const side of [-1, 1]) for (let i = 0; i < slats; i++) s += `<rect x="${side > 0 ? 30 : -46}" y="${20 + i * 4}" width="16" height="2.5" rx="1"/>`;
    g.push(`<g class="${cls('radiator', 'slat')}">${s}</g>`);
    if (labels && hl.includes('radiator')) text(-50, 26, 'end', `Radiators ${n1(Rr)} m²`);
  }

  // RTGs on a boom below the tank
  if (n > 0) {
    let s = `<line x1="26" y1="28" x2="26" y2="94" class="strut"/><line x1="26" y1="94" x2="${34 + 26 * n}" y2="94" class="strut"/>`;
    for (let i = 0; i < n; i++) {
      const x = 32 + 26 * i;
      s += `<rect x="${x}" y="88.5" width="22" height="11" rx="3" class="rtgbody"/><path d="M${x + 6} 88.5v11M${x + 11} 88.5v11M${x + 16} 88.5v11" class="fins"/>`;
    }
    g.push(`<g class="${cls('rtg')}">${s}</g>`);
    if (labels && hl.includes('rtg')) text(34 + 26 * n, 80, 'end', `RTG × ${n}`);
  }

  // shielding wraps the bus; thicker with more centimeters
  let sh = 0;
  if (S > 0) {
    sh = 1 + S * 0.7;
    g.push(`<g class="${cls('shield')}"><rect x="${-(28 + sh / 2)}" y="${-(28 + sh / 2)}" width="${56 + sh}" height="${56 + sh}" rx="8" class="shieldring" style="stroke-width:${sh.toFixed(1)}"/><rect x="${-(28 + sh / 2)}" y="${-(28 + sh / 2)}" width="${56 + sh}" height="${56 + sh}" rx="8" class="shieldhatch" style="stroke-width:${Math.max(0.8, sh - 1.2).toFixed(1)}"/></g>`);
    if (labels && hl.includes('shield')) text(-(28 + sh) - 4, -(28 + sh) - 2, 'end', `Shielding ${n1(S)} cm`);
  }

  // tank, then engine
  g.push(`<circle cx="0" cy="${28 + geo.rt}" r="${geo.rt.toFixed(1)}" class="${cls('tank', 'tank')}"/>`);
  if (labels && hl.includes('tank')) text((geo.rt + 8).toFixed(1), (28 + geo.rt + 4).toFixed(1), 'start', `Fuel ${Math.round(paramVal(d, 'fuel'))} kg`);
  const y0 = geo.y0;
  if (d.engine === 'biprop') g.push(`<path d="M-5 ${y0}L5 ${y0}L11 ${y0 + 16}L-11 ${y0 + 16}Z" class="${cls('engine', 'nozzle')}"/>`);
  else if (d.engine === 'ion') g.push(`<g class="${cls('engine', 'nozzle')}"><rect x="-3" y="${y0 - 3}" width="6" height="3"/><rect x="-11" y="${y0}" width="22" height="4"/><path d="M-6 ${y0}v4M0 ${y0}v4M6 ${y0}v4" class="fins"/></g>`);
  else g.push(`<rect x="-5" y="${y0}" width="10" height="7" rx="1.5" class="${cls('engine', 'nozzle')}"/>`);
  if (labels && hl.includes('engine')) text(16, y0 + 12, 'start', d.engine === 'ion' ? 'Ion engine' : d.engine === 'biprop' ? 'Biprop engine' : 'Thrusters');

  // the bus, its instrument, and the battery
  g.push('<rect x="-28" y="-28" width="56" height="56" rx="6" class="bus"/>');
  if (pay === 'cam') g.push('<g class="inst"><circle cx="0" cy="8" r="9"/><circle cx="0" cy="8" r="4" class="lens"/></g>');
  else if (pay === 'spec') g.push('<g class="inst"><rect x="-6" y="-2" width="12" height="24" rx="2"/><path d="M-6 6h12M-6 14h12"/></g>');
  else g.push('<g class="inst"><rect x="-22" y="10" width="44" height="12" rx="2"/><path d="M-11 10v12M0 10v12M11 10v12"/></g>');
  if (hasNight) g.push(`<rect x="-22" y="-23" width="${(6 + 0.4 * kWh).toFixed(1)}" height="6" rx="1" class="${cls('battery', 'battery')}"/>`);

  // dish on a mast, with one to three signal arcs for transmitter power
  const rd = Math.max(3, dish * 9); const yd = -42;
  const arcs = 1 + (tx >= 40 ? 1 : 0) + (tx >= 75 ? 1 : 0);
  let arcPath = '';
  for (let i = 1; i <= arcs; i++) { const r = 5 + i * 6; arcPath += `M${-r * 0.7} ${(yd - rd * 0.78 - r * 0.7).toFixed(1)}A${r} ${r} 0 0 1 ${r * 0.7} ${(yd - rd * 0.78 - r * 0.7).toFixed(1)}`; }
  g.push(`<g class="${cls('dish')}"><line x1="0" y1="-28" x2="0" y2="${yd}" class="strut"/><path d="M${-rd} ${(yd - rd * 0.35).toFixed(1)}Q0 ${(yd + rd * 0.5).toFixed(1)} ${rd} ${(yd - rd * 0.35).toFixed(1)}Z" class="dishbowl"/><line x1="0" y1="${yd}" x2="0" y2="${(yd - rd * 0.78).toFixed(1)}" class="strut"/><circle cx="0" cy="${(yd - rd * 0.78).toFixed(1)}" r="2" class="feed"/><path d="${arcPath}" class="arcs"/></g>`);
  if (labels && hl.includes('dish')) text((rd + 10).toFixed(1), -44, 'start', `Dish ${n1(dish)} m · ${tx} W`);

  return g.join('') + lab.join('');
}

// The build panel: the craft centered in its own box.
export function craftSVG(d, { screen = null } = {}) {
  const hl = (screen && HIGHLIGHT[screen]) || [];
  return `<svg viewBox="0 0 340 212" class="craft${hl.length ? ' focus' : ''}" role="img" aria-label="Your spacecraft"><g transform="translate(170 98)">${craftGroup(d, { hl, labels: true })}</g></svg>`;
}

