// Pixel-art rockets, redrawn from the real vehicles (same width:height as the originals, not to scale
// with each other). Each sprite is written as the LEFT half of the vehicle, centre column included;
// it is mirrored, shaded on the right (light comes from the left) and outlined in black.
// Palette = sweetie16, same hexes as style.css. rocketURL('f9') -> image data URL, cached.
const PAL = { k: '#1a1c2c', w: '#f4f4f4', l: '#c8d4de', s: '#94b0c2', e: '#566c86', d: '#333c57', o: '#ef7d57', y: '#ffcd75', r: '#b13e53' };
const SHADE = { w: 'l', l: 's', s: 'e', e: 'd', o: 'r', y: 'o' }; // right-hand side is one step darker
const rep = (row, n) => Array(n).fill(row);
const flip = (s) => [...s].reverse().join('');

// A grid is an array of equal-length strings; '.' is empty.
const padTo = (g, w, left) => g.map((r) => (left ? r.padStart(w, '.') : r.padEnd(w, '.')));
const widthOf = (g) => Math.max(...g.map((r) => r.length));

// Mirror left halves (centre column last) into full rows. The outermost shaded pixel on the right is darkest.
function mirror(half) {
  const hw = widthOf(half);
  return half.map((r) => {
    const L = r.padStart(hw, '.');
    const R = flip(L.slice(0, -1)).replace(/[^.]/g, (c) => SHADE[c] || c);
    return L + R;
  });
}

// Put grid b on top of grid a at column x, row y (spaces and '.' in b are transparent).
function blit(a, b, x, y) {
  const out = a.map((r) => [...r]);
  b.forEach((row, j) => [...row].forEach((c, i) => { if (c !== '.' && out[y + j] && out[y + j][x + i] !== undefined) out[y + j][x + i] = c; }));
  return out.map((r) => r.join(''));
}
const blank = (w, h) => rep('.'.repeat(w), h);

// ---- Electron (Rocket Lab): 18 m x 1.2 m, matte black carbon composite, small ogive fairing ----
const electron = mirror([
  '..e', '..e', '..e', '.ee', '.ee', '.ed', '.ed', '.ed', 'edd', 'edd', 'edd', 'edd', // ogive fairing
  ...rep('edd', 4), 'sss', 'edd',                                                        // payload adapter band
  ...rep('edd', 18), 'lll',                                                               // second stage, stage separation
  ...rep('edd', 5), 'ded',                                                                // interstage
  ...rep('edd', 30), 'lll', 'edd', 'edd',                                                 // first stage tank (RP-1/LOX)
  'ded', 'sss', '.sd', '.so', '.sy',                                                      // octaweb, Rutherford bells, plume
]);

// ---- Falcon 9: 70 m x 3.7 m, white, black interstage + engine section, grid fins, 4 landing legs ----
function falcon9() {
  const body = mirror([
    '...w', '...w', '..ww', '..ww', '.www', '.www', '.www', '.www',       // 5.2 m fairing: nose + ogive
    ...rep('lwww', 8),                                                   // fairing cylinder
    'seee',                                                              // fairing separation line
    ...rep('.lww', 16),                                                  // second stage (3.7 m)
    '.ddd', '.ddd', '.ddd',                                              // black interstage
    ...rep('.lww', 4), '.sww', ...rep('.lww', 24),                       // first stage tank
    '.eee', '.ddd', '.ddd',                                              // engine section
    '.ess', '.sdd',                                                      // nine Merlins
  ]);
  const w = widthOf(body); const top = 8 + 8 + 1 + 16 + 3 + 4; // row of the grid fins
  let g = blank(w + 8, body.length + 2);
  g = blit(g, body, 4, 0);
  // titanium grid fins, folded out from the top of the first stage
  g = blit(g, ['ee', 'dd'], 3, top); g = blit(g, ['ee', 'dd'], w + 3, top);
  // landing legs: black struts splaying out from the engine section
  const base = body.length - 8;
  g = blit(g, ['d', 'd', 'd', 'd'], 3, base - 6); g = blit(g, ['d', 'd', 'd', 'd'], w + 4, base - 6);
  for (let i = 0; i < 6; i++) { g = blit(g, ['d'], 4 - Math.floor(i / 2) - 1, base - 2 + i); g = blit(g, ['d'], w + 4 + Math.floor(i / 2), base - 2 + i); }
  g = blit(g, ['dd'], 0, base + 4); g = blit(g, ['dd'], w + 6, base + 4);
  return g;
}

// ---- Ares I (NASA, cancelled 2010): 94 m. Launch-abort tower, Orion capsule, orange J-2X upper stage, 5-segment white SRB ----
const ares = mirror([
  ...rep('..r', 2), ...rep('..d', 12), '..y', '..y',                    // launch abort motor needle
  '..w', '.ww', '.ww', 'www', 'www', 'wws',                              // Orion capsule + service module
  ...rep('loo', 1), ...rep('loo', 20), 'eed',              // upper stage (foam-orange), 5.5 m
  'eed', 'eed',                                                          // interstage ring
  ...[0, 1, 2, 3, 4].flatMap((i) => [...rep('.ww', 8), i < 4 ? '.dd' : '.ww']), // five SRB segments, black joints
  '.ee', '.sd', '.so', '.sy',                                            // nozzle + plume
]);

// ---- Falcon Heavy: 70 m x 12.2 m. A Falcon 9 core between two Falcon 9 boosters with conical noses ----
function falconHeavy() {
  const core = mirror([
    '..w', '.ww', 'lww', 'www', 'www', ...rep('lww', 8), 'ddd', 'ddd', ...rep('lww', 10), 'sww',
    ...rep('lww', 30), 'eee', 'ddd', 'ess', 'sdd',
  ]);
  const side = mirror([
    '..w', '..w', '.ww', '.ww', 'www', 'www', 'www', ...rep('.ww', 0),
    ...rep('lww', 6), 'ddd', ...rep('lww', 28), 'eee', 'ess', 'sdd',
  ]);
  const w = 3 * 5 + 2; const h = core.length;
  let g = blank(w, h);
  g = blit(g, core, 6, 0);
  g = blit(g, side, 0, h - side.length); g = blit(g, side, w - 5, h - side.length);
  // forward and aft cross-braces tying the boosters to the core
  g = blit(g, ['dd'], 4, h - 20); g = blit(g, ['dd'], w - 6, h - 20);
  return g;
}

const GRIDS = { light: () => electron, f9: falcon9, medium: () => ares, heavy: falconHeavy };

// Outline every sprite in black and pad by one pixel.
function outlined(g) {
  const w = widthOf(g) + 2; const rows = [blank(w, 1)[0], ...g.map((r) => '.' + r.padEnd(w - 2, '.') + '.'), blank(w, 1)[0]];
  return rows.map((r, y) => [...r].map((c, x) => {
    if (c !== '.') return c;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = rows[y + dy]?.[x + dx]; if (n && n !== '.' && n !== 'k') return 'k'; }
    return '.';
  }).join(''));
}

export const rocketGrid = (id) => outlined(GRIDS[id]());

const cache = {};
export function rocketURL(id) {
  if (!GRIDS[id]) return '';
  if (cache[id]) return cache[id];
  const g = rocketGrid(id); const c = document.createElement('canvas');
  c.width = widthOf(g); c.height = g.length; const x = c.getContext('2d');
  g.forEach((row, j) => [...row].forEach((ch, i) => { if (PAL[ch]) { x.fillStyle = PAL[ch]; x.fillRect(i, j, 1, 1); } }));
  return (cache[id] = c.toDataURL());
}
