// Budget graphs: each budget plotted over mission time against its limit.
// buildCharts() turns a design into chart specs (no DOM); renderChart() makes SVG.
import { BUS, G0 } from './data.js';
import {
  budgets, marginColor, heatAt, doseAt, powerAt, needAt, ESTIMATE, fmtYr, fmtGb, STORM_YEARS,
} from './model.js';

// Two series hues, validated (dataviz validate_palette.js, dark, surface #141b33).
const C1 = '#3f8fe6';
const C2 = '#c0802a';
const R = Math.round;

export const CHART_ORDER = ['power', 'thermal', 'rad', 'data', 'cost', 'mass', 'dv', 'life', 'night'];
export const CHART_LABEL = {
  power: 'Power', thermal: 'Heat', rad: 'Radiation', data: 'Data', cost: 'Cost',
  mass: 'Mass', dv: 'Fuel', life: 'Part life', night: 'Night battery',
};

// Which budget graph explains each failure mode.
export function chartForFailure(f, b) {
  if (!f) return null;
  if (f.mode === 'insertion') return f.ion ? 'power' : 'dv';
  if (f.mode === 'flyby') return b.tr.flyby === 'venus' ? 'thermal' : 'rad';
  return {
    cost: 'cost', launcher: 'mass', brownout: 'power', freeze: 'power', storm: 'power', overheat: 'thermal',
    radiation: 'rad', life: 'life', night: 'night', data: 'data',
  }[f.mode] || null;
}

function sample(f, t0, t1, extra = [], n = 140) {
  const ts = new Set();
  for (let i = 0; i <= n; i++) ts.add(t0 + ((t1 - t0) * i) / n);
  for (const x of extra) if (x >= t0 && x <= t1) ts.add(x);
  return [...ts].sort((a, b) => a - b).map((t) => [t, f(t)]);
}

// First sample where pred(t) holds.
function firstWhere(pts, pred) {
  const hit = pts.find(([t, y]) => pred(t, y));
  return hit ? hit[0] : null;
}

const minM = (...ms) => {
  const nums = ms.filter((m) => typeof m === 'number');
  return nums.length ? Math.min(...nums) : null;
};

// failure: the launch's first failure (result screen). Lines stop where the spacecraft died.
export function buildCharts(d, opts = ESTIMATE, failure = null) {
  const b = budgets(d, opts);
  const { P, D, tr } = b;
  if (!D || !tr || !P.power || !P.thermal || !P.payload || !P.comms || !P.engine || !P.tank || !P.launcher) return null;
  const cruise = tr.cruise; const end = cruise + D.opsYears;
  const stop = failure && !failure.partial && failure.t > 0 ? Math.min(end, failure.t) : end;
  const eps = 1e-4;
  const keyT = [cruise - eps, cruise, cruise + eps];
  if (tr.flyby) keyT.push(tr.flybyYear - 0.031, tr.flybyYear - eps, tr.flybyYear, tr.flybyYear + 0.031);
  if (D.stormYear) { const s = cruise + D.stormYear; keyT.push(s - eps, s, s + STORM_YEARS, s + STORM_YEARS + eps); }
  if (opts.event && opts.event.dose) { const e = cruise * opts.eventFrac; keyT.push(e - eps, e); }
  const base = { xMax: end, cruise, dest: D.name, xUnit: 'yr' };
  const out = {};

  // Power: supply over time vs what the spacecraft needs at the destination.
  {
    const supply = sample((t) => powerAt(t, b), 0, stop, keyT);
    const need = sample((t) => needAt(t, b), cruise, end, keyT, 60);
    const markers = [];
    if (P.engine.lowThrust) markers.push({ t: cruise, y: b.ionLoad, label: `Ion engine needs ${R(b.ionLoad)} W`, bad: b.ionMargin < 0 });
    if (D.stormYear) markers.push({ t: cruise + D.stormYear + STORM_YEARS / 2, y: b.stormLoad, label: 'Dust storm', note: true });
    const short = firstWhere(supply, (t, y) => t >= cruise && y < needAt(t, b));
    out.power = {
      ...base, key: 'power', title: 'Power', unit: 'W', fmt: (v) => `${v >= 10 ? R(v) : v.toFixed(1)} W`,
      series: [{ name: 'Power available', color: C1, pts: supply }, { name: `Power needed at ${D.name}`, color: 'var(--ink2)', dash: true, pts: need }],
      markers,
      fail: P.engine.lowThrust && b.ionMargin < 0 ? { t: cruise, y: b.supplyArrive, label: 'Ion engine starved' } : short != null ? { t: short, y: powerAt(short, b), label: 'Not enough power' } : null,
      status: marginColor(minM(b.powerMargin, b.ionMargin, D.id === 'mars' ? b.hazardMargin : null)),
      caption: `End of mission: ${R(b.supplyEnd)} W available, ${R(b.load)} W needed (bus ${BUS.powerW} W + ${P.payload.name.toLowerCase()} ${P.payload.powerW} W + antenna ${P.comms.powerW} W${b.heater ? ` + heaters ${R(b.heater)} W` : ''}).`,
    };
  }

  // Heat: sunlight on the craft vs what the thermal system can reject.
  {
    const pts = sample((t) => heatAt(t, b), 0, stop, keyT, 200);
    const over = firstWhere(pts, (t, y) => y > b.hotLimit);
    out.thermal = {
      ...base, key: 'thermal', title: 'Heat', unit: 'x Earth sun', fmt: (v) => `${v < 0.1 ? v.toFixed(3) : v.toFixed(1)}x sun`,
      series: [{ name: 'Heat on the spacecraft', color: C1, pts }],
      limits: [{ y: b.hotLimit, label: `${P.thermal.name} max ${b.hotLimit}x` }],
      fail: over != null ? { t: over, y: b.hotLimit, label: 'Overheats' } : null,
      status: marginColor(minM(b.thermalMargin, tr.flyby === 'venus' ? b.flybyMargin : null)),
      caption: `Sunlight in multiples of Earth's${P.power.type === 'rtg' ? ', plus RTG waste heat' : ''}.${D.coldW ? ` The cold side shows up as ${R(b.heater)} W of heaters in the Power graph.` : ''}`,
    };
  }

  // Radiation: accumulated dose vs what the electronics can take.
  {
    const pts = sample((t) => doseAt(t, b), 0, stop, keyT);
    const over = firstWhere(pts, (t, y) => y > b.radTol);
    out.rad = {
      ...base, key: 'rad', title: 'Radiation', unit: 'krad', fmt: (v) => `${R(v)} krad`,
      series: [{ name: 'Dose so far', color: C1, pts }],
      limits: [{ y: b.radTol, label: `${P.thermal.name} survives ${b.radTol} krad` }],
      fail: over != null ? { t: over, y: b.radTol, label: 'Electronics fail' } : null,
      status: marginColor(minM(b.radMargin, tr.flyby === 'jupiter' ? b.flybyMargin : null)),
      caption: `Dose adds up: ${D.cruiseDosePerYr} krad/yr cruising, ${D.opsDosePerYr} krad/yr at ${D.name}${tr.flyby ? `, plus the ${tr.flyby === 'jupiter' ? 'Jupiter' : 'Venus'} flyby` : ''}.`,
    };
  }

  // Data: collected vs actually sent home, against the goal.
  {
    const rate = Math.min(b.genPerYr, b.downPerYr);
    const sent = sample((t) => (t < cruise ? 0 : rate * (t - cruise)), 0, stop, keyT, 80);
    const coll = sample((t) => (t < cruise ? 0 : b.genPerYr * (t - cruise)), 0, stop, keyT, 80);
    const ymax = Math.max(D.fullGb, rate * D.opsYears) * 1.35;
    const genLimited = b.genPerYr <= b.downPerYr;
    out.data = {
      ...base, key: 'data', title: 'Data', unit: 'Gbit', fmt: (v) => fmtGb(v), yMax: ymax,
      series: genLimited
        ? [{ name: 'Sent home', color: C1, pts: sent }]
        : [{ name: 'Sent home', color: C1, pts: sent }, { name: b.genPerYr * D.opsYears > ymax ? 'Collected on board (runs off the top)' : 'Collected on board', color: C2, pts: coll }],
      limits: [{ y: D.fullGb, label: `Goal ${D.fullGb} Gbit` }],
      fail: b.returnable < D.fullGb && stop === end ? { t: end, y: rate * D.opsYears, label: `${R((100 * b.returnable) / D.fullGb)}% of goal` } : null,
      status: marginColor(b.dataMargin),
      caption: genLimited
        ? `The ${P.payload.name.toLowerCase()} makes ${fmtGb(b.genPerYr)}/yr; the antenna could send more.`
        : `The ${P.payload.name.toLowerCase()} makes ${fmtGb(b.genPerYr)}/yr, but the ${P.comms.name.toLowerCase()} only sends ${fmtGb(b.downPerYr)}/yr from ${D.name}.`,
    };
  }

  // Cost: money spent so far vs budget.
  {
    const up = b.partCost + b.launchCost;
    const pts = [[0, up], [end, b.cost]];
    const over = b.cost > b.budget ? (b.budget - up) / D.opsCostPerYr : null;
    out.cost = {
      ...base, key: 'cost', title: 'Cost', unit: '$M', fmt: (v) => `$${R(v)}M`,
      series: [{ name: 'Spent so far', color: C1, pts }],
      limits: [{ y: b.budget, label: `Budget $${b.budget}M` }],
      fail: over != null ? { t: Math.max(0, over), y: b.budget, label: over <= 0 ? 'Over before launch' : 'Money runs out' } : null,
      status: marginColor(b.costMargin),
      caption: `Parts $${R(b.partCost)}M + ${P.launcher.name.toLowerCase()} $${b.launchCost}M at launch, then the team at $${D.opsCostPerYr}M/yr for ${fmtYr(end)}.`,
    };
  }

  // Mass: the fueled spacecraft at liftoff vs what the rocket can lift; drops after the arrival burn.
  {
    const isp = P.engine.isp * ((opts.event && opts.event.ispFactor) || 1);
    const after = b.dvAvail >= b.dvReq ? b.wet / Math.exp(b.dvReq / (isp * G0)) : b.dry;
    const curve = (wet, aft) => [[0, wet], [cruise - eps, wet], [cruise, aft], [end, aft]];
    const series = [{ name: 'Spacecraft mass', color: C1, pts: curve(b.wet, after) }];
    if (opts.growth > 0) {
      const e = budgets(d, ESTIMATE);
      series.push({ name: 'Estimate on paper', color: 'var(--ink2)', dash: true, pts: curve(e.wet, e.dvAvail >= e.dvReq ? e.wet / Math.exp(e.dvReq / (P.engine.isp * G0)) : e.dry) });
    }
    out.mass = {
      ...base, key: 'mass', title: 'Mass', unit: 'kg', fmt: (v) => `${R(v)} kg`,
      series,
      limits: [{ y: b.cap, label: `${P.launcher.name} lifts ${R(b.cap)} kg`, x1: Math.max(cruise * 0.6, end * 0.25) }],
      fail: b.wet > b.cap ? { t: 0, y: b.wet, label: 'Too heavy to launch' } : null,
      status: marginColor(b.massMargin),
      caption: `Dry ${R(b.dry)} kg (incl. ${R(b.structure * (1 + (opts.growth || 0)))} kg structure) + ${b.prop} kg propellant. The rocket only matters at liftoff.`,
    };
  }

  // Fuel: delta-v left in the tank vs the arrival burn.
  {
    const left = Math.max(0, b.dvAvail - b.dvReq);
    out.dv = {
      ...base, key: 'dv', title: 'Fuel (delta-v)', unit: 'm/s', fmt: (v) => `${R(v)} m/s`,
      series: [{ name: 'Delta-v in the tank', color: C1, pts: [[0, b.dvAvail], [cruise - eps, b.dvAvail], [cruise, left], [end, left]] }],
      limits: [{ y: b.dvReq, label: `Arrival burn needs ${R(b.dvReq)} m/s`, x1: cruise }],
      fail: b.dvAvail < b.dvReq ? { t: cruise, y: b.dvAvail, label: `Short ${R(b.dvReq - b.dvAvail)} m/s` } : null,
      status: marginColor(b.dvMargin),
      caption: `${P.tank.name} (${b.prop} kg) + ${P.engine.name.toLowerCase()} (Isp ${P.engine.isp} s) pushing ${R(b.dry)} kg dry.${b.dvPenalty > 1 ? ` Low thrust: the burn costs ${b.dvPenalty}x more.` : ''}`,
    };
  }

  // Part life: each part's design life vs how long it has to work.
  out.life = {
    ...base, key: 'life', kind: 'bars', title: 'Part life', unit: 'yr',
    rows: b.lifeChecks.map((c) => ({ name: c.part.name, life: c.part.life, need: c.need, engine: c.key === 'engine' })),
    status: marginColor(b.lifeMargin),
    caption: 'Each bar is how long a part is designed to last. The engine only has to last until the arrival burn.',
  };

  // Moon: battery through the 14-day night.
  if (D.id === 'moon') {
    const drain = b.nightNeedWh / D.nightHours; // Wh per hour
    const days = D.nightHours / 24;
    const pts = sample((x) => Math.max(0, b.batteryWh - drain * x * 24), 0, days, [], 60);
    const empty = drain > 0 && b.batteryWh < b.nightNeedWh ? b.batteryWh / drain / 24 : null;
    out.night = {
      key: 'night', title: 'Night battery', unit: 'kWh', xMax: days, xUnit: 'day', fmt: (v) => `${(v / 1000).toFixed(1)} kWh`,
      series: [{ name: 'Battery charge', color: C1, pts }],
      limits: [{ y: 0, label: 'Empty' }],
      fail: empty != null ? { t: empty, y: 0, label: `Dead on day ${Math.ceil(empty)}` } : null,
      status: marginColor(b.hazardMargin),
      caption: `Survival load ${R(b.nightLoad)} W (bus + heaters)${P.power.type === 'rtg' ? ', partly covered by the RTG' : ''}, for 14 days with no sun.`,
    };
  }
  return out;
}

// ---------- rendering ----------
const REG = new Map();
let uid = 0;
export function resetCharts() { REG.clear(); }

const STATUS = { green: ['ok', '✓ OK'], yellow: ['thin', '! Thin margin'], red: ['bad', '✗ Fails'], none: ['', ''], na: ['', ''] };
export const statusBadge = (s) => { const [c, t] = STATUS[s] || STATUS.none; return t ? `<span class="sbadge ${c}">${t}</span>` : ''; };

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const tickFmt = (v) => (Math.abs(v) >= 10000 ? `${R(v / 1000)}k` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : Math.abs(v) >= 10 || v === 0 ? `${R(v)}` : v >= 1 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2));

export function renderChart(spec, { big = false } = {}) {
  if (!spec) return '';
  const body = spec.kind === 'bars' ? barsSVG(spec) : lineSVG(spec);
  const legend = spec.series && spec.series.length > 1
    ? `<div class="legend">${spec.series.map((s) => `<span><i class="${s.dash ? 'dash' : ''}" style="--c:${s.color}"></i>${s.name}</span>`).join('')}</div>` : '';
  return `<figure class="chart ${big ? 'big' : ''} st-${spec.status}">
    <figcaption class="c-head"><b>${spec.title}</b>${statusBadge(spec.status)}</figcaption>
    ${legend}${body}<p class="c-cap">${spec.caption}</p></figure>`;
}

const W = 340; const H = 168; const L = 40; const RM = 10; const T = 12; const B = 24;

function lineSVG(spec) {
  const id = `c${uid++}`; REG.set(id, spec);
  const pw = W - L - RM; const ph = H - T - B;
  const ys = [];
  for (const s of spec.series) for (const p of s.pts) ys.push(p[1]);
  for (const l of spec.limits || []) ys.push(l.y);
  for (const m of spec.markers || []) ys.push(m.y);
  const yMax = spec.yMax || niceMax(Math.max(...ys) * 1.12);
  const yMin = spec.yMin < 0 ? -niceMax(-spec.yMin * 1.1) : 0;
  const x = (t) => L + (pw * t) / spec.xMax;
  const y = (v) => T + ph * (1 - (v - yMin) / (yMax - yMin));
  spec._geo = { L, pw, x, y };
  const g = [];
  // cruise band
  if (spec.cruise != null && spec.cruise > 0) {
    g.push(`<rect x="${L}" y="${T}" width="${x(spec.cruise) - L}" height="${ph}" class="band"/>`);
    if (x(spec.cruise) - L > 40) g.push(`<text x="${L + 4}" y="${T + 10}" class="bandlbl">cruise</text>`);
    if (L + pw - x(spec.cruise) > 50) g.push(`<text x="${x(spec.cruise) + 4}" y="${T + 10}" class="bandlbl">at ${spec.dest}</text>`);
  }
  // grid + y ticks
  for (const v of [yMin, (yMin + yMax) / 2, yMax]) {
    g.push(`<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`);
    g.push(`<text x="${L - 5}" y="${y(v) + 3.5}" class="ytick">${tickFmt(v)}</text>`);
  }
  // x ticks
  const xm = spec.xMax;
  const step = spec.xUnit === 'day' ? 2 : xm <= 1.5 ? 0.25 : xm <= 4 ? 1 : xm <= 12 ? 2 : 5;
  for (let t = 0; t <= xm + 1e-9; t += step) g.push(`<text x="${x(t)}" y="${H - 8}" class="xtick">${+t.toFixed(2)}</text>`);
  g.push(`<text x="${L + pw}" y="${H - 8}" class="xunit" text-anchor="end">${spec.xUnit === 'day' ? 'days of night' : 'years'}</text>`);
  // series (clipped to the plot)
  g.push(`<clipPath id="${id}cp"><rect x="${L}" y="${T - 2}" width="${pw}" height="${ph + 4}"/></clipPath><g clip-path="url(#${id}cp)">`);
  for (const l of spec.limits || []) {
    const x2 = x(l.x1 != null ? l.x1 : xm);
    g.push(`<line x1="${L}" x2="${x2}" y1="${y(l.y)}" y2="${y(l.y)}" class="limit"/>`);
  }
  for (const s of spec.series) {
    if (!s.pts.length) continue;
    const dpath = s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
    g.push(`<path d="${dpath}" class="ser${s.dash ? ' dash' : ''}" style="stroke:${s.color}"/>`);
  }
  g.push('</g>');
  for (const l of spec.limits || []) {
    const x2 = x(l.x1 != null ? l.x1 : xm);
    const above = y(l.y) - T > 14;
    g.push(`<text x="${x2 - 2}" y="${above ? y(l.y) - 4 : y(l.y) + 12}" class="limlbl" text-anchor="end">${l.label}</text>`);
  }
  for (const m of spec.markers || []) {
    if (m.note) { g.push(`<text x="${Math.min(x(m.t), L + pw - 4)}" y="${T + 22}" class="bandlbl" text-anchor="middle">${m.label}</text>`); continue; }
    g.push(`<rect x="${x(m.t) - 4}" y="${y(m.y) - 4}" width="8" height="8" transform="rotate(45 ${x(m.t)} ${y(m.y)})" class="mkr ${m.bad ? 'bad' : ''}"/>`);
    g.push(`<text x="${Math.min(x(m.t) + 8, L + pw - 2)}" y="${y(m.y) - 6}" class="limlbl" text-anchor="${x(m.t) > L + pw * 0.6 ? 'end' : 'start'}">${m.label}</text>`);
  }
  if (spec.fail) {
    const fx = x(spec.fail.t); const fy = Math.max(T, Math.min(T + ph, y(spec.fail.y)));
    g.push(`<circle cx="${fx}" cy="${fy}" r="6" class="failpt"/>`);
    const right = fx < L + pw * 0.55;
    g.push(`<text x="${right ? fx + 10 : fx - 10}" y="${fy + (fy < T + 20 ? 14 : -8)}" class="faillbl" text-anchor="${right ? 'start' : 'end'}">✗ ${spec.fail.label}</text>`);
  }
  // hover layer
  g.push(`<line class="xhair" x1="0" x2="0" y1="${T}" y2="${T + ph}" style="display:none"/>`);
  g.push(`<rect class="hit" x="${L}" y="${T}" width="${pw}" height="${ph}"/>`);
  return `<div class="plot"><svg viewBox="0 0 ${W} ${H}" data-chart="${id}" role="img" aria-label="${spec.title}: ${spec.caption.replace(/"/g, '')}">${g.join('')}</svg><div class="tip" hidden></div></div>`;
}

function barsSVG(spec) {
  const rows = spec.rows; const rowH = 22; const top = 8; const left = 112;
  const h = top + rows.length * rowH + 22; const pw = W - left - RM;
  const xMax = niceMax(Math.max(spec.xMax * 1.25, ...rows.map((r) => Math.min(r.life, spec.xMax * 1.6))));
  const x = (t) => left + (pw * Math.min(t, xMax)) / xMax;
  const g = [];
  const end = spec.xMax;
  rows.forEach((r, i) => {
    const yy = top + i * rowH;
    const bad = r.life < r.need;
    g.push(`<text x="${left - 6}" y="${yy + 14}" class="ytick">${r.name.replace(/\s*\(.*\)/, '')}</text>`);
    g.push(`<rect x="${left}" y="${yy + 4}" width="${Math.max(2, x(r.life) - left - 1)}" height="12" rx="3" style="fill:${C1}"/>`);
    if (bad) g.push(`<rect x="${x(r.life) + 1}" y="${yy + 4}" width="${Math.max(2, x(r.need) - x(r.life) - 1)}" height="12" rx="3" class="gap"/>`);
    g.push(`<line x1="${x(r.need)}" x2="${x(r.need)}" y1="${yy + 1}" y2="${yy + 19}" class="need"/>`);
    const lbl = `${r.life} yr${r.life > xMax ? ' →' : ''}${bad ? ` ✗ needs ${fmtYr(r.need)}` : ''}`;
    const lx = bad ? x(r.need) + 4 : x(r.life) + 4;
    g.push(`<text x="${Math.min(lx, W - RM)}" y="${yy + 14}" class="${bad ? 'faillbl' : 'limlbl'}" text-anchor="${lx > W - 60 ? 'end' : 'start'}">${lbl}</text>`);
  });
  const by = top + rows.length * rowH;
  g.push(`<line x1="${x(end)}" x2="${x(end)}" y1="${top - 4}" y2="${by}" class="limit"/>`);
  g.push(`<text x="${x(end)}" y="${by + 14}" class="limlbl" text-anchor="middle">mission ends ${fmtYr(end)}</text>`);
  return `<div class="plot"><svg viewBox="0 0 ${W} ${h}" role="img" aria-label="Part design life vs mission length">${g.join('')}</svg></div>`;
}

// Crosshair + readout on hover/touch.
export function attachHover(root) {
  const move = (e) => {
    const svg = e.target.closest && e.target.closest('svg[data-chart]'); if (!svg) return;
    const spec = REG.get(svg.dataset.chart); if (!spec || !spec._geo) return;
    const { L: l, pw } = spec._geo;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    const t = Math.max(0, Math.min(spec.xMax, ((p.x - l) / pw) * spec.xMax));
    const xh = svg.querySelector('.xhair'); xh.style.display = ''; xh.setAttribute('x1', p.x); xh.setAttribute('x2', p.x);
    const vals = spec.series.map((s) => {
      const v = interp(s.pts, t);
      return v == null ? '' : `<div><i class="${s.dash ? 'dash' : ''}" style="--c:${s.color}"></i>${s.name}: <b>${spec.fmt(v)}</b></div>`;
    }).join('');
    const tip = svg.parentElement.querySelector('.tip');
    tip.hidden = false;
    tip.innerHTML = `<div class="tip-t">${spec.xUnit === 'day' ? `Day ${t.toFixed(1)}` : `Year ${t.toFixed(t < 1 ? 2 : 1)}${spec.cruise != null && t < spec.cruise ? ' · cruise' : ''}`}</div>${vals}`;
    const frac = (p.x - l) / pw;
    tip.style.left = frac > 0.5 ? '' : `${(p.x / W) * 100 + 3}%`;
    tip.style.right = frac > 0.5 ? `${100 - (p.x / W) * 100 + 3}%` : '';
  };
  const leave = (e) => {
    const svg = e.target.closest && e.target.closest('svg[data-chart]'); if (!svg) return;
    svg.querySelector('.xhair').style.display = 'none';
    svg.parentElement.querySelector('.tip').hidden = true;
  };
  root.addEventListener('pointermove', move);
  root.addEventListener('pointerdown', move);
  root.addEventListener('pointerout', leave);
}

function interp(pts, t) {
  if (!pts.length || t < pts[0][0] || t > pts[pts.length - 1][0]) return null;
  for (let i = 1; i < pts.length; i++) {
    const [t0, y0] = pts[i - 1]; const [t1, y1] = pts[i];
    if (t <= t1) return t1 === t0 ? y1 : y0 + ((y1 - y0) * (t - t0)) / (t1 - t0);
  }
  return pts[pts.length - 1][1];
}
