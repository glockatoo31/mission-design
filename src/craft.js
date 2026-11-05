// The spacecraft, drawn from your design in the pixel-art style. Every slider changes the picture:
// array area, RTG count, radiators, shielding, dish size, transmitter power, fuel, engine, instrument.
// Everything is built from 4-unit pixels on one grid (offset by 2 so shapes can be centered on an odd
// number of pixels). Colors are the sweetie16 keys in style.css (.k-w, .k-y, ...). 1 m of array ~ 20 px.
import { paramVal, parts } from './model.js';

const n1 = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const U = 4;
const sn = (v) => Math.round((v - 2) / U) * U + 2; // snap a position to the pixel grid
const sz = (v) => Math.max(U, Math.round(v / U) * U); // snap a size to whole pixels
const odd = (v) => { const n = Math.max(1, Math.round(v / U)); return (n % 2 ? n : n + 1) * U; };
const R = (x, y, w, h, c) => `<rect x="${sn(x)}" y="${sn(y)}" width="${sz(w)}" height="${sz(h)}" class="k-${c}"/>`;
const Rc = (y, w, h, c) => { const W = odd(w); return `<rect x="${-W / 2}" y="${sn(y)}" width="${W}" height="${sz(h)}" class="k-${c}"/>`; }; // centered

// Geometry that other drawings (the launch scene's flame) need.
export function craftGeom(d) {
  const fuel = paramVal(d, 'fuel');
  const rt = U * Math.round((4 + 1.4 * Math.cbrt(fuel)) / U); // tank radius, whole pixels
  const y0 = 30 + 2 * rt; // top of the engine
  const eng = d.engine;
  const len = eng === 'biprop' ? 16 : 8;
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
  const cls = (id) => `part ${hl.includes(id) ? 'hl' : ''}`.trim();
  const g = []; const lab = [];
  const text = (x, y, anchor, t) => lab.push(`<text x="${x}" y="${y}" class="clabel" text-anchor="${anchor}">${t}</text>`);

  // solar wings, mirrored, hung high on the bus so radiators fit underneath
  if (A > 0) {
    const Lw = sz(20 * Math.sqrt(A)); const Wd = sz(10 * Math.sqrt(A)); const wy = sn(-14 - Wd / 2);
    const cols = Math.max(1, Math.floor(Lw / 16)); const rows = Math.max(1, Math.floor(Wd / 16));
    for (const side of [-1, 1]) {
      const x = side > 0 ? 38 : -38 - Lw;
      let w = R(side > 0 ? 30 : -38, -14, 8, 4, 's') + R(x, wy, Lw, Wd, 'b') + R(x, wy, Lw, 4, 'a') + R(x, wy, 4, Wd, 'a') + R(x, wy + Wd - 4, Lw, 4, 'n') + R(x + Lw - 4, wy, 4, Wd, 'n');
      for (let i = 1; i < cols; i++) w += R(x + (i * Lw) / cols, wy + 4, 4, Wd - 8, 'n');
      for (let i = 1; i < rows; i++) w += R(x + 4, wy + (i * Wd) / rows, Lw - 8, 4, 'n');
      g.push(`<g class="${cls('arrays')}">${w}</g>`);
    }
    if (labels && hl.includes('arrays')) text((38 + Lw).toFixed(1), (wy - 7).toFixed(1), 'end', `Arrays ${n1(A)} m²`);
  }

  // radiator panels, one per side under the wings: light and mid-gray slats
  if (Rr > 0) {
    const rh = sz(Rr * 6); let s = '';
    for (const side of [-1, 1]) for (let i = 0; i < rh / U; i++) s += R(side > 0 ? 30 : -46, 22 + i * U, 16, U, i % 2 ? 'l' : 'w');
    g.push(`<g class="${cls('radiator')}">${s}</g>`);
    if (labels && hl.includes('radiator')) text(-50, 26, 'end', `Radiators ${n1(Rr)} m²`);
  }

  // RTGs on a boom below the tank: dark bodies, fins, a warm end
  if (n > 0) {
    let s = R(26, 30, 4, 64, 's') + R(26, 92, 8 + 26 * n, 4, 's');
    for (let i = 0; i < n; i++) {
      const x = 32 + 26 * i;
      s += R(x, 86, 24, 16, 'd') + R(x + 4, 86, 4, 16, 's') + R(x + 12, 86, 4, 16, 's') + R(x + 20, 90, 4, 8, 'o');
    }
    g.push(`<g class="${cls('rtg')}">${s}</g>`);
    if (labels && hl.includes('rtg')) text(34 + 26 * n, 80, 'end', `RTG × ${n}`);
  }

  // shielding wraps the bus: a slate ring with a hatch of light pixels; thicker with more centimeters
  if (S > 0) {
    const t = sz(1 + S * 0.7); const o = 30 + t;
    let s = R(-o, -o, 60 + 2 * t, t, 's') + R(-o, 30, 60 + 2 * t, t, 's') + R(-o, -30, t, 60, 's') + R(30, -30, t, 60, 's');
    for (let x = -o; x < o; x += 2 * U) s += R(x, -o, U, U, 'l') + R(x, 30 + t - U, U, U, 'l');
    for (let y = -30; y < 30; y += 2 * U) s += R(-o, y, U, U, 'l') + R(30 + t - U, y, U, U, 'l');
    g.push(`<g class="${cls('shield')}">${s}</g>`);
    if (labels && hl.includes('shield')) text(-o - 4, -o - 2, 'end', `Shielding ${n1(S)} cm`);
  }

  // tank: a pixel disc, lit top-left, shaded right
  {
    const r = geo.rt; let s = '';
    for (let i = 0; i < (2 * r) / U; i++) {
      const dy = (i + 0.5) * U - r; const W = odd(2 * Math.sqrt(Math.max(U * U, r * r - dy * dy))); const y = 30 + i * U;
      s += `<rect x="${-W / 2}" y="${y}" width="${W}" height="${U}" class="k-l"/><rect x="${W / 2 - 2 * U}" y="${y}" width="${2 * U}" height="${U}" class="k-s"/>${i < r / U ? `<rect x="${-W / 2}" y="${y}" width="${U}" height="${U}" class="k-w"/>` : ''}`;
    }
    g.push(`<g class="${cls('tank')}">${s}</g>`);
    if (labels && hl.includes('tank')) text((r + 8).toFixed(1), (30 + r + 4).toFixed(1), 'start', `Fuel ${Math.round(paramVal(d, 'fuel'))} kg`);
  }
  const y0 = geo.y0;
  if (d.engine === 'biprop') g.push(`<g class="${cls('engine')}">${[12, 12, 20, 28].map((w, i) => Rc(y0 + i * U, w, U, i === 3 ? 'd' : 's')).join('')}</g>`);
  else if (d.engine === 'ion') g.push(`<g class="${cls('engine')}">${Rc(y0, 12, U, 's')}${Rc(y0 + U, 28, 2 * U, 'd')}${R(-10, y0 + U, U, 2 * U, 's')}${R(-2, y0 + U, U, 2 * U, 's')}${R(6, y0 + U, U, 2 * U, 's')}</g>`);
  else g.push(`<g class="${cls('engine')}">${Rc(y0, 12, U, 's')}${Rc(y0 + U, 12, U, 'd')}</g>`);
  if (labels && hl.includes('engine')) text(20, y0 + 12, 'start', d.engine === 'ion' ? 'Ion engine' : d.engine === 'biprop' ? 'Biprop engine' : 'Thrusters');

  // the bus (gold foil: lit top-left, shaded bottom-right), its instrument, and the battery
  g.push(`${R(-30, -30, 60, 60, 'r')}${R(-30, -30, 56, 56, 'o')}${R(-30, -30, 52, 52, 'y')}${R(-26, -26, 12, 4, 'w')}${R(-26, -26, 4, 12, 'w')}`);
  if (pay === 'cam') g.push(`<g class="inst">${Rc(2, 20, 20, 'k')}${Rc(6, 12, 12, 'a')}${R(-2, 6, 4, 4, 'c')}</g>`);
  else if (pay === 'spec') g.push(`<g class="inst">${Rc(-2, 12, 28, 'd')}${R(-6, 6, 12, 4, 's')}${R(-6, 14, 12, 4, 's')}${R(-2, -2, 4, 4, 'a')}</g>`);
  else g.push(`<g class="inst">${Rc(10, 44, 12, 'd')}${R(-14, 10, 4, 12, 's')}${R(-2, 10, 4, 12, 's')}${R(10, 10, 4, 12, 's')}</g>`);
  if (hasNight) { const bw = 6 + 0.4 * kWh; g.push(`<g class="${cls('battery')}">${R(-26, -26, bw, 2 * U, 'g')}${R(-26, -26, bw, U, 'p')}</g>`); }

  // dish on a mast: a stepped bowl, a feed on top, one to three pixel arcs for transmitter power
  {
    const rd = Math.max(U, dish * 9); const m = Math.max(1, Math.round((rd * 0.8) / U)); const yTop = sn(-42 - rd * 0.35);
    let s = ''; const botY = yTop + (m + 1) * U;
    if (botY < -30) s += Rc(botY, U, -30 - botY, 's');
    for (let k = 0; k <= m; k++) s += Rc(yTop + k * U, 2 * rd * (1 - (k / (m + 1)) ** 2), U, k === 0 ? 'w' : k === m ? 's' : 'l');
    const feedY = sn(-42 - rd * 0.78);
    if (feedY + U < yTop) s += Rc(feedY + U, U, yTop - feedY - U, 's');
    s += Rc(feedY, U, U, 'o');
    const arcs = 1 + (tx >= 40 ? 1 : 0) + (tx >= 75 ? 1 : 0); const seen = new Set();
    for (let i = 1; i <= arcs; i++) {
      for (let a = -150; a <= -30; a += 12) {
        const rr = 6 + 8 * i; const x = sn(rr * Math.cos((a * Math.PI) / 180)); const y = sn(feedY + rr * Math.sin((a * Math.PI) / 180));
        if (!seen.has(`${x},${y}`)) { seen.add(`${x},${y}`); s += `<rect x="${x}" y="${y}" width="${U}" height="${U}" class="k-c"/>`; }
      }
    }
    g.push(`<g class="${cls('dish')}">${s}</g>`);
    if (labels && hl.includes('dish')) text((rd + 10).toFixed(1), -44, 'start', `Dish ${n1(dish)} m · ${tx} W`);
  }

  return g.join('') + lab.join('');
}

// The build panel: the craft centered in its own box.
export function craftSVG(d, { screen = null } = {}) {
  const hl = (screen && HIGHLIGHT[screen]) || [];
  return `<svg viewBox="0 0 340 212" class="craft${hl.length ? ' focus' : ''}" role="img" aria-label="Your spacecraft"><g transform="translate(170 98)">${craftGroup(d, { hl, labels: true })}</g></svg>`;
}
