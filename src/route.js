// A top-down, high-level map of the solar system and the route a trajectory takes through it.
// Used on the Trajectory page (preview before you pick) and in the launch scene (the craft flies it).
// Orbit radii are compressed (log scale) so Mercury and Pluto fit on one small map.
const CX = 170; const CY = 110;
const rLog = (au) => 12 + 26 * Math.log10(1 + 3 * au);
// Scale each map so its outermost orbit (the destination, or Earth) fills the panel.
const scaleOf = (D) => 88 / rLog(Math.max(D.sunAU, 1));
const rOf = (au, sc) => rLog(au) * sc;
const BODY = {
  mercury: { au: 0.39, color: '#b5a48f', label: 'Mercury' }, venus: { au: 0.72, color: '#ffcd75', label: 'Venus' },
  earth: { au: 1, color: '#41a6f6', label: 'Earth' }, mars: { au: 1.52, color: '#ef7d57', label: 'Mars' },
  jupiter: { au: 5.2, color: '#ef7d57', label: 'Jupiter' }, europa: { au: 5.2, color: '#d8c7a3', label: 'Europa' }, pluto: { au: 33, color: '#d9b38c', label: 'Pluto' },
};
// Gravity-assist stops on the way, in order, for the "assist" route of each destination.
const ASSISTS = { mercury: ['venus'], mars: ['earth'], europa: ['mars', 'earth'], pluto: ['jupiter'] };

const pt = (r, deg) => [CX + r * Math.cos((deg * Math.PI) / 180), CY + r * Math.sin((deg * Math.PI) / 180)];

// The route as a polyline path plus the bodies it touches (departure, assists, arrival).
export function routeGeom(D, trajId) {
  const mids = trajId === 'assist' ? (ASSISTS[D.id] || []) : [];
  const stops = [{ name: 'earth', au: 1 }, ...mids.map((n) => ({ name: n, au: BODY[n].au, assist: true })), { name: D.id, au: D.sunAU, dest: true }];
  const sc = scaleOf(D); let th = 180; const pts = []; const marks = [{ ...stops[0], th }];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]; const b = stops[i];
    const loop = Math.abs(a.au - b.au) < 1e-6; // an Earth flyby: loop out and come back
    const sweep = loop ? 330 : 150;
    for (let k = 0; k <= 40; k++) {
      const t = k / 40; const s = 3 * t * t - 2 * t * t * t;
      const r = rOf(a.au, sc) + (rOf(b.au, sc) - rOf(a.au, sc)) * s + (loop ? 14 * Math.sin(Math.PI * t) : 0);
      pts.push(pt(r, th + sweep * t));
    }
    th += sweep; marks.push({ ...b, th });
  }
  return { d: `M${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}`, marks };
}

const sq = (x, y, s, color) => `<rect x="${(x - s / 2).toFixed(1)}" y="${(y - s / 2).toFixed(1)}" width="${s}" height="${s}" fill="${color}"/>`;

// Sun, planet orbits, and the labelled bodies the chosen route touches.
export function mapBase(D, marks) {
  const sc = scaleOf(D);
  const orbits = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'pluto'].filter((n) => BODY[n].au <= Math.max(D.sunAU, 1.6) + 0.01 || n === 'earth')
    .map((n) => `<circle cx="${CX}" cy="${CY}" r="${rOf(BODY[n].au, sc).toFixed(1)}" class="smap-orbit"/>`).join('');
  const bodies = marks.map((m) => {
    const b = BODY[m.name]; const [x, y] = pt(rOf(m.au, sc), m.th); const dest = m.dest;
    return `${sq(x, y, dest ? 12 : 8, b.color)}<text x="${(x + (x > CX ? 9 : -9)).toFixed(1)}" y="${(y + 4).toFixed(1)}" class="smap-lbl" style="text-anchor:${x > CX ? 'start' : 'end'}">${b.label}</text>`;
  }).join('');
  return `${orbits}${sq(CX, CY, 10, '#ffcd75')}${sq(CX, CY, 4, '#ef7d57')}${bodies}`;
}

// The Trajectory page preview: the selected route in full, the other one faint behind it.
export function trajMapSVG(D, selected) {
  const other = selected === 'direct' ? 'assist' : 'direct';
  const sel = routeGeom(D, selected); const alt = routeGeom(D, other);
  return `<svg viewBox="0 0 340 220" class="smap" role="img" aria-label="Route to ${D.name}">${mapBase(D, sel.marks)}<path d="${alt.d}" class="smap-alt"/><path d="${sel.d}" class="smap-sel"/></svg>`;
}
