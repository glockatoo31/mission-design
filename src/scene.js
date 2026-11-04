// Launch animation: the rocket lifts off, the craft cruises along its route, then lands or
// orbits and sends data home. update() is driven by the launch loop in main.js.
import { craftGroup, craftGeom } from './craft.js';

const ROCKET = { light: [18, 64], f9: [21, 74], medium: [24, 84], heavy: [32, 110] };
const PLANET_R = { mercury: 9, moon: 10, mars: 11, europa: 14, pluto: 8 };
const LANDS = new Set(['moon', 'mars']); // shortcut: Pluto's flyby is drawn as an orbit, draw a pass-by if it matters
const E = [34, 150]; const S = [296, 96]; const EARTH_OPS = [30, 30];
const ease = (t) => 1 - (1 - t) * (1 - t);
const lerp = (a, b, t) => a + (b - a) * t;

export function createScene(el, { design, b, failure }) {
  const D = b.D; const land = LANDS.has(D.id); const [rw, rh] = ROCKET[design.launcher];
  const geo = craftGeom(design); const craft = craftGroup(design);
  const path = design.traj === 'assist' ? 'M34 150Q165 10 296 96' : 'M34 150Q165 118 296 96';
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const stars = Array.from({ length: 36 }, () => `<circle cx="${(rnd() * 340).toFixed(0)}" cy="${(rnd() * 190).toFixed(0)}" r="${(0.5 + rnd()).toFixed(1)}" class="star"/>`).join('');
  const craftNode = (id, flame) => `<g id="${id}" class="craft">${craft}${flame ? `<polygon id="${id}-f" class="flame"/>` : ''}</g>`;
  el.innerHTML = `<svg viewBox="0 0 340 220" class="scene" role="img" aria-label="Launch animation">
    <g id="sc-stars">${stars}</g>
    <g id="sc-launch">
      <rect x="0" y="190" width="340" height="30" class="ground"/>
      <g id="sc-rocket">
        ${rw > 24 ? `<rect x="${-rw / 2 - 9}" y="${-rh * 0.55}" width="8" height="${rh * 0.55}" rx="2" class="rbody"/><rect x="${rw / 2 + 1}" y="${-rh * 0.55}" width="8" height="${rh * 0.55}" rx="2" class="rbody"/>` : ''}
        <rect x="${-rw / 2}" y="${-rh}" width="${rw}" height="${rh}" class="rbody"/>
        <path d="M${-rw / 2} ${-rh}Q0 ${-rh - rw * 1.4} ${rw / 2} ${-rh}Z" class="rbody"/>
        <rect x="${-rw / 2}" y="${-rh * 0.3}" width="${rw}" height="3" class="rband"/>
        <polygon id="sc-flame" class="flame"/>
      </g>
      <g id="sc-burst">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<line x1="0" y1="0" x2="${(Math.cos((a * Math.PI) / 180) * 26).toFixed(1)}" y2="${(Math.sin((a * Math.PI) / 180) * 26).toFixed(1)}"/>`).join('')}</g>
    </g>
    <g id="sc-transit">
      <circle cx="${E[0]}" cy="${E[1]}" r="15" class="earth"/><text x="${E[0]}" y="${E[1] + 30}" class="slabel" text-anchor="middle">Earth</text>
      <path id="sc-path" d="${path}" class="route"/><path id="sc-trail" d="${path}" class="trail"/>
      <circle cx="${S[0]}" cy="${S[1]}" r="${PLANET_R[D.id]}" style="fill:${D.color}"/><text x="${S[0]}" y="${S[1] + 28}" class="slabel" text-anchor="middle">${D.name}</text>
      ${craftNode('sc-craft1')}
    </g>
    <g id="sc-ops">
      ${land ? `<circle cx="170" cy="430" r="260" style="fill:${D.color}"/><circle cx="170" cy="430" r="260" class="shade"/>`
    : `<ellipse cx="170" cy="120" rx="96" ry="30" class="orbit"/><circle cx="170" cy="120" r="46" style="fill:${D.color}"/><circle cx="196" cy="128" r="46" class="shade" clip-path="circle(46px at 170px 120px)"/>`}
      <circle cx="${EARTH_OPS[0]}" cy="${EARTH_OPS[1]}" r="5" class="earth"/>
      <line id="sc-beam" x1="0" y1="0" x2="0" y2="0" class="beam"/>
      ${craftNode('sc-craft2', true)}
    </g>
    <g id="sc-dead"><circle r="24"/><path d="M-9-9L9 9M9-9L-9 9"/></g>
  </svg>`;

  const $ = (id) => el.querySelector(`#${id}`);
  const route = $('sc-path'); const total = route.getTotalLength();
  const flameAt = (node, tipY, w, len) => node.setAttribute('points', `${-w / 2},${tipY} ${w / 2},${tipY} 0,${tipY + len}`);
  const place = (node, x, y, s) => node.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s})`);
  const show = (id, on) => { $(id).style.opacity = on ? 1 : 0; };

  // ph: 0 liftoff, 1 cruise, 2 arrival burn, 3 operations. p: progress inside the phase. ms drives flicker.
  function update({ ph, p, ms, dead }) {
    show('sc-launch', ph === 0); show('sc-transit', ph === 1); show('sc-ops', ph >= 2);
    $('sc-stars').style.opacity = ph === 0 ? Math.min(1, p * 1.6) : 1;
    const flick = 0.5 + 0.5 * Math.sin(ms / 45);
    let mark = null;
    if (ph === 0) {
      const y = 190 - 150 * p * p;
      $('sc-rocket').setAttribute('transform', `translate(170 ${y.toFixed(1)})`);
      flameAt($('sc-flame'), 0, rw * 0.7, p > 0 || ms > 0 ? 12 + 16 * flick + 20 * p : 0);
      $('sc-launch').querySelector('.ground').setAttribute('transform', `translate(0 ${(60 * p).toFixed(1)})`);
      mark = [170, y - rh / 2];
      $('sc-burst').setAttribute('transform', `translate(${mark[0]} ${mark[1]})`);
      $('sc-burst').style.opacity = dead && failure.mode === 'launcher' ? 1 : 0;
      $('sc-rocket').style.opacity = dead && failure.mode === 'launcher' ? 0 : 1;
    } else if (ph === 1) {
      const pt = route.getPointAtLength(p * total);
      place($('sc-craft1'), pt.x, pt.y, 0.22);
      $('sc-trail').style.strokeDasharray = `${p * total} ${total}`;
      mark = [pt.x, pt.y];
    } else {
      const g2 = $('sc-craft2'); let x; let y;
      if (land) { x = 170; y = ph === 2 ? lerp(-30, 140, ease(p)) : 140; }
      else if (ph === 2) { x = lerp(-30, 74, ease(p)); y = lerp(40, 120, ease(p)); } else {
        const th = Math.PI + 4 * Math.PI * p; x = 170 + 96 * Math.cos(th); y = 120 + 30 * Math.sin(th);
        g2.style.opacity = Math.sin(th) < 0 && Math.abs(x - 170) < 46 ? 0.25 : 1; // behind the planet
      }
      if (ph === 2) g2.style.opacity = 1;
      place(g2, x, y, 0.3);
      flameAt($('sc-craft2-f'), geo.tip, geo.w, ph === 2 ? (1 - p) * 26 + 8 * flick : 0);
      const beam = $('sc-beam');
      beam.style.opacity = ph === 3 && !dead ? 0.8 : 0;
      beam.setAttribute('x1', x); beam.setAttribute('y1', y); beam.setAttribute('x2', EARTH_OPS[0]); beam.setAttribute('y2', EARTH_OPS[1]);
      beam.style.strokeDashoffset = (-ms * 0.05).toFixed(1);
      mark = [x, y];
    }
    const d = $('sc-dead');
    d.style.opacity = dead && failure.mode !== 'launcher' ? 1 : 0;
    if (mark) d.setAttribute('transform', `translate(${mark[0].toFixed(1)} ${mark[1].toFixed(1)})`);
    if (dead && failure.mode !== 'launcher') for (const id of ['sc-craft1', 'sc-craft2']) $(id).style.opacity = 0.5;
  }
  return { update };
}
