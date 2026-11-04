// Budget graphs. Every graph says the same thing the same way:
//   blue line  = what your design gives you
//   orange line = the limit or the need
//   red shading / red dot = where it breaks
// A one-line verdict sits above each graph so nobody has to decode it.
import { G0 } from './data.js';
import {
  budgets, budgetMargins, marginColor, heatAt,  doseAt, powerAt, needAt, ESTIMATE, fmtYr, fmtGb, STORM_YEARS,
} from './model.js';
import { BUDGET_LABEL } from './coupling.js';
import { STATUS_ICON } from './icons.js';

// Two series hues, validated (dataviz validate_palette.js, dark, surface #141b33).
const BLUE = '#3f8fe6';
const ORANGE = '#c0802a';
const R = Math.round;

export const CHART_ORDER = ['power', 'thermal', 'rad', 'data', 'time', 'cost', 'mass', 'dv', 'life', 'night'];
export const CHART_LABEL = { ...BUDGET_LABEL, night: 'Night battery' };

// Which graph explains each failure mode.
export function chartForFailure(f, b) {
  if (!f) return null;
  if (f.mode === 'insertion') return f.ion ? 'power' : 'dv';
  if (f.mode === 'flyby') return b.tr.flyby === 'venus' ? 'thermal' : 'rad';
  if (f.mode === 'deadline') return 'time';
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

const firstWhere = (pts, pred) => { const h = pts.find(([t, y]) => pred(t, y)); return h ? h[0] : null; };

const when = (t) => (t < 0.1 ? 'on arrival' : `in year ${fmtYr(t, true)}`);

// status + margin + one-line verdict from the same number
function judge(margin, text, fail) {
  const status = marginColor(margin);
  const verdict = status === 'red' ? text.bad(fail) : status === 'yellow' ? text.thin : text.ok;
  return { status, margin, verdict };
}

const LIFE_NAME = { power: 'Power system', thermal: 'Thermal system', comms: 'Antenna' };
const lifeLabel = (c, P) => LIFE_NAME[c.key] || c.part.name;

// failure: the launch's first failure (result screen). Lines stop where the spacecraft died.
export function buildCharts(d, opts = ESTIMATE, failure = null) {
  const b = budgets(d, opts);
  const { P, D, tr } = b;
  if (!D || !tr || !P.power || !P.thermal || !P.payload || !P.comms || !P.engine || !P.tank || !P.launcher) return null;
  const M = budgetMargins(b);
  const cruise = tr.cruise; const end = cruise + D.opsYears;
  const stop = failure && !failure.partial && failure.t > 0 ? Math.min(end, failure.t) : end;
  const eps = 1e-4;
  const keyT = [cruise - eps, cruise, cruise + eps];
  if (tr.flyby) keyT.push(tr.flybyYear - 0.031, tr.flybyYear - eps, tr.flybyYear, tr.flybyYear + 0.031);
  if (D.stormYear) { const s = cruise + D.stormYear; keyT.push(s - eps, s, s + STORM_YEARS, s + STORM_YEARS + eps); }
  if (opts.event && opts.event.dose) { const e = cruise * opts.eventFrac; keyT.push(e - eps, e); }
  const base = { xMax: end, cruise, dest: D.name, xUnit: 'yr' };
  const out = {};
  const have = (pts) => ({ name: 'Your design', color: BLUE, pts });

  // Power: what the power system gives vs what the spacecraft needs.
  {
    const supply = sample((t) => powerAt(t, b), 0, stop, keyT);
    const need = sample((t) => needAt(t, b), cruise, end, keyT, 60);
    const short = firstWhere(supply, (t, y) => t >= cruise && y < needAt(t, b));
    const ion = P.engine.lowThrust && b.ionMargin < 0;
    const fail = ion ? { t: cruise, y: b.supplyArrive, label: 'Ion engine starved' } : short != null ? { t: short, y: powerAt(short, b), label: 'Not enough power' } : null;

    out.power = {
      ...base, key: 'power', title: 'Power', fmt: (v) => `${v >= 10 ? R(v) : v.toFixed(1)} W`, unit: 'W',
      series: [{ ...have(supply), name: 'Power you have' }, { name: 'Power you need', color: ORANGE, pts: need, limit: true }, { aux: true, color: ORANGE, dash: true, pts: cruise > 0.1 ? [[0, needAt(cruise, b)], [cruise, needAt(cruise, b)]] : [] }],
      fail, ...judge(M.power, { ok: 'Enough power all mission', thin: 'Power is cutting it close', bad: (f) => (ion ? 'Ion engine cannot fire at arrival' : f ? `Power runs short ${when(f.t)}` : 'Not enough power') }, fail),
      note: `Need ${R(b.load)} W: bus + mission + antenna${b.heater ? ' + heaters' : ''}`,
    };
  }

  // Heat: sunlight on the craft vs what the thermal system can reject.
  {
    const pts = sample((t) => heatAt(t, b), 0, stop, keyT, 200);
    const over = firstWhere(pts, (t, y) => y > b.hotLimit);
    const fail = over != null ? { t: over, y: b.hotLimit, label: 'Overheats' } : null;
    out.thermal = {
      ...base, key: 'thermal', title: 'Heat', unit: 'x sun', fmt: (v) => `${v < 0.1 ? v.toFixed(3) : v.toFixed(1)}x sun`,
      series: [have(pts)],
      limits: [{ y: b.hotLimit, label: 'Radiator limit', dir: 'above' }],
      fail, ...judge(M.thermal, { ok: 'Stays cool enough', thin: 'Close to overheating', bad: (f) => `Overheats ${when(f ? f.t : cruise)}` }, fail),
      note: `Includes transmitter${P.power.hasRtg ? ' and RTG' : ''} waste heat. 1x = sunlight at Earth.`,
    };
  }

  // Radiation: accumulated dose vs what the electronics can take.
  {
    const pts = sample((t) => doseAt(t, b), 0, stop, keyT);
    const over = firstWhere(pts, (t, y) => y > b.radTol);
    const fail = over != null ? { t: over, y: b.radTol, label: 'Electronics fail' } : null;
    out.rad = {
      ...base, key: 'rad', title: 'Radiation', unit: 'krad', fmt: (v) => `${R(v)} krad`,
      series: [{ ...have(pts), name: 'Dose so far' }],
      limits: [{ y: b.radTol, label: 'Shielding limit', dir: 'above' }],
      fail, ...judge(M.rad, { ok: 'Electronics survive', thin: 'Close to the radiation limit', bad: (f) => `Electronics fail ${when(f ? f.t : cruise)}` }, fail),
      note: `${D.cruiseDosePerYr} krad/yr on the trip, ${D.opsDosePerYr} at ${D.name}${tr.flyby ? `, plus the ${tr.flyby === 'jupiter' ? 'Jupiter' : 'Venus'} flyby` : ''}`,
    };
  }

  // Data: science sent home vs the goal.
  {
    const rate = Math.min(b.genPerYr, b.downPerYr);
    const sent = sample((t) => rate * Math.max(0, t - cruise), cruise, Math.max(stop, cruise + 1e-3), [], 60);
    const pctGoal = R((100 * b.returnable) / b.goalGb);
    const fail = b.returnable < b.goalGb && stop === end ? { t: end, y: rate * D.opsYears, label: `${pctGoal}% of goal` } : null;
    out.data = {
      ...base, xMin: cruise, cruise: 0, xLabel: `years at ${D.name}`, key: 'data', title: 'Data', unit: 'Gbit', fmt: (v) => fmtGb(v), yMax: Math.max(b.goalGb, rate * D.opsYears) * 1.35,
      series: [{ ...have(sent), name: 'Sent home' }],
      limits: [{ y: b.goalGb, label: `Goal: ${b.goalGb} Gbit` }],
      fail, ...judge(b.dataMargin, { ok: 'Hits the data goal', thin: 'Barely hits the data goal', bad: () => `Only ${pctGoal}% of the goal` }, fail),
      note: `Mission makes ${fmtGb(b.genPerYr)}/yr. Antenna sends ${fmtGb(b.downPerYr)}/yr.`,
    };
  }

  // Schedule: when you arrive vs the contract deadline.
  out.time = {
    ...base, key: 'time', kind: 'timeline', title: 'Schedule', deadline: b.deadline,
    ...judge(b.timeMargin, { ok: 'Arrives before the deadline', thin: 'Arrives just before the deadline', bad: () => `Arrives ${fmtYr(cruise - b.deadline)} too late` }, null),
    note: `${fmtYr(cruise)} trip. Contract deadline: ${fmtYr(b.deadline)}.`,
  };

  // Cost: money spent so far vs budget.
  {
    const up = b.partCost + b.launchCost;
    const over = b.cost > b.budget ? (b.budget - up) / D.opsCostPerYr : null;
    const fail = over != null ? { t: Math.max(0, over), y: b.budget, label: 'Over budget' } : null;
    out.cost = {
      ...base, key: 'cost', title: 'Cost', unit: '$M', fmt: (v) => `$${R(v)}M`,
      series: [{ ...have([[0, up], [end, b.cost]]), name: 'Spent so far' }],
      limits: [{ y: b.budget, label: `Budget: $${b.budget}M`, dir: 'above' }],
      fail, ...judge(b.costMargin, { ok: 'Within budget', thin: 'Close to the budget', bad: () => `Over budget by $${R(b.cost - b.budget)}M` }, fail),
      note: `$${R(up)}M for parts and rocket, then $${D.opsCostPerYr}M every year`,
    };
  }

  // Mass: the fueled spacecraft vs what the rocket can lift (only matters at liftoff).
  {
    const isp = P.engine.isp * ((opts.event && opts.event.ispFactor) || 1);
    const after = b.dvAvail >= b.dvReq ? b.wet / Math.exp(b.dvReq / (isp * G0)) : b.dry;
    const curve = (wet, aft) => [[0, wet], [cruise - eps, wet], [cruise, aft], [end, aft]];
    const series = [{ ...have(curve(b.wet, after)), name: 'Real hardware' }];
    if (opts.growth > 0) {
      const e = budgets(d, ESTIMATE);
      series.unshift({ name: 'On paper', color: '#9aa5c8', dash: true, pts: curve(e.wet, e.dvAvail >= e.dvReq ? e.wet / Math.exp(e.dvReq / (P.engine.isp * G0)) : e.dry) });
    }
    const fail = b.wet > b.cap ? { t: 0, y: b.wet, label: 'Too heavy' } : null;
    out.mass = {
      ...base, key: 'mass', title: 'Mass', unit: 'kg', fmt: (v) => `${R(v)} kg`,
      series,
      limits: [{ y: b.cap, label: `${P.launcher.name} limit`, dir: 'above', x1: Math.max(cruise * 0.6, end * 0.25) }],
      fail, ...judge(b.massMargin, { ok: 'The rocket can lift it', thin: 'Close to the rocket limit', bad: () => `Too heavy by ${R(b.wet - b.cap)} kg` }, fail),
      note: `${R(b.dry)} kg spacecraft + ${b.prop} kg fuel. Drops when fuel is burned.`,
    };
  }

  // Fuel: delta-v in the tank vs the arrival burn.
  {
    const left = Math.max(0, b.dvAvail - b.dvReq);
    const fail = b.dvAvail < b.dvReq ? { t: cruise, y: b.dvAvail, label: `Short ${R(b.dvReq - b.dvAvail)} m/s` } : null;
    out.dv = {
      ...base, key: 'dv', title: 'Fuel', unit: 'm/s', fmt: (v) => `${R(v)} m/s`,
      series: [{ ...have([[0, b.dvAvail], [cruise - eps, b.dvAvail], [cruise, left], [end, left]]), name: 'Speed change available' }],
      limits: [{ y: b.dvReq, label: `Burn needs ${R(b.dvReq)} m/s`, x1: cruise }],
      fail, ...judge(b.dvMargin, { ok: 'Enough fuel for the burn', thin: 'Barely enough fuel', bad: () => `Short by ${R(b.dvReq - b.dvAvail)} m/s` }, fail),
      note: b.dvPenalty > 1 ? `Low thrust: the burn costs ${b.dvPenalty}x more.` : 'Delta-v = how much your engine and fuel can change your speed.',
    };
  }

  // Part life: how long each part lasts vs how long it must work.
  out.life = {
    ...base, key: 'life', kind: 'bars', title: 'Part life', unit: 'yr',
    rows: b.lifeChecks.map((c) => ({ name: lifeLabel(c, P), life: c.part.life, need: c.need })),
    ...judge(b.lifeMargin, { ok: 'Every part lasts', thin: 'A part is close to wearing out', bad: () => `${lifeLabel(b.weakest, P)} wears out` }, null),
    note: 'Bar = how long the part lasts. Line = how long it must work.',
  };

  // Moon: battery through the 14-day night.
  if (D.id === 'moon') {
    const drain = b.nightNeedWh / D.nightHours;
    const days = D.nightHours / 24;
    const pts = sample((x) => Math.max(0, b.batteryWh - drain * x * 24), 0, days, [], 60);
    const empty = drain > 0 && b.batteryWh < b.nightNeedWh ? b.batteryWh / drain / 24 : null;
    const fail = empty != null ? { t: empty, y: 0, label: `Dead on day ${Math.ceil(empty)}` } : null;
    out.night = {
      key: 'night', title: 'Night battery', unit: 'kWh', xMax: days, xUnit: 'day', fmt: (v) => `${(v / 1000).toFixed(1)} kWh`,
      series: [{ ...have(pts), name: 'Battery charge' }],
      limits: [{ y: 0, label: 'Empty', dir: 'below' }],
      fail, ...judge(b.hazardMargin, { ok: 'Battery lasts the night', thin: 'Battery barely lasts the night', bad: () => `Battery dies on day ${Math.ceil(empty)}` }, fail),
      note: `${R(b.nightLoad)} W of heaters and bus for 14 days with no sun`,
    };
  }
  return out;
}

// ---------- rendering ----------
const REG = new Map();
let uid = 0;
export function resetCharts() { REG.clear(); }

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const tickFmt = (v) => (Math.abs(v) >= 10000 ? `${R(v / 1000)}k` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : Math.abs(v) >= 10 || v === 0 ? `${R(v)}` : v >= 1 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2));

export function renderChart(spec) {
  if (!spec) return '';
  const body = spec.kind === 'bars' ? barsSVG(spec) : spec.kind === 'timeline' ? timelineSVG(spec) : lineSVG(spec);
  const shown = (spec.series || []).filter((s) => !s.aux);
  const legend = shown.length > 1
    ? `<div class="legend">${shown.map((s) => `<span><i class="${s.dash ? 'dash' : ''}" style="--c:${s.color}"></i>${s.name}</span>`).join('')}</div>` : '';
  return `<figure class="chart st-${spec.status}">
    <div class="c-title">${spec.title}${typeof spec.margin === 'number' ? ` <span class="c-m ${spec.status}">${spec.margin >= 0 ? '+' : '−'}${Math.abs(R(spec.margin * 100))}%</span>` : ''}</div>
    <div class="verdict ${spec.status}">${STATUS_ICON[spec.status] || STATUS_ICON.green}<span>${spec.verdict}</span></div>
    ${legend}${body}${spec.note ? `<p class="c-cap">${spec.note.replace(/\.$/, '')}</p>` : ''}</figure>`;
}

const W = 340; const H = 210; const L = 46; const RM = 14; const T = 14; const B = 44;

function lineSVG(spec) {
  const id = `c${uid++}`; REG.set(id, spec);
  const pw = W - L - RM; const ph = H - T - B;
  const ys = [];
  for (const s of spec.series) for (const p of s.pts) ys.push(p[1]);
  for (const l of spec.limits || []) ys.push(l.y);
  const yMax = spec.yMax || niceMax(Math.max(...ys) * 1.15);
  const x0 = spec.xMin || 0; const span = spec.xMax - x0;
  const x = (t) => L + (pw * (t - x0)) / span;
  const y = (v) => T + ph * (1 - v / yMax);
  spec._geo = { L, pw, x, y };
  const g = [];
  const baseY = T + ph;

  // trip vs destination shading, labelled under the axis
  if (spec.cruise > 0 && spec.cruise < spec.xMax) {
    g.push(`<rect x="${L}" y="${T}" width="${x(spec.cruise) - L}" height="${ph}" class="band"/>`);
    const w1 = x(spec.cruise) - L; const w2 = L + pw - x(spec.cruise);
    if (w1 > 36) g.push(`<text x="${L + w1 / 2}" y="${H - 5}" class="phase" text-anchor="middle">trip</text>`);
    if (w2 > 50) g.push(`<text x="${x(spec.cruise) + w2 / 2}" y="${H - 5}" class="phase" text-anchor="middle">at ${spec.dest}</text>`);
  }
  // danger zones above upper limits
  for (const l of spec.limits || []) {
    if (l.dir === 'above' && y(l.y) > T) g.push(`<rect x="${L}" y="${T}" width="${x(l.x1 != null ? l.x1 : spec.xMax) - L}" height="${y(l.y) - T}" class="danger"/>`);
  }
  // axes: just 0 and the top value
  g.push(`<line x1="${L}" x2="${L + pw}" y1="${baseY}" y2="${baseY}" class="axis"/>`);
  g.push(`<text x="${L - 6}" y="${baseY + 4}" class="ytick">0</text>`);
  g.push(`<text x="${L - 6}" y="${T + 4}" class="ytick">${tickFmt(yMax)}</text>`);
  g.push(`<text x="${L - 6}" y="${T + 18}" class="yunit">${spec.unit}</text>`);
  const xm = spec.xMax;
  const step = spec.xUnit === 'day' ? 2 : span <= 1.5 ? 0.25 : span <= 4 ? 1 : span <= 12 ? 2 : 5;
  for (let k = 0; k * step <= span + 1e-9; k++) g.push(`<text x="${x(x0 + k * step)}" y="${baseY + 16}" class="xtick">${+(k * step).toFixed(2)}</text>`);
  g.push(`<text x="${L + pw}" y="${baseY + 30}" class="phase" text-anchor="end">${spec.xLabel || (spec.xUnit === 'day' ? 'days' : 'years')}</text>`);

  g.push(`<clipPath id="${id}cp"><rect x="${L}" y="${T - 2}" width="${pw}" height="${ph + 6}"/></clipPath><g clip-path="url(#${id}cp)">`);
  for (const l of spec.limits || []) g.push(`<line x1="${L}" x2="${x(l.x1 != null ? l.x1 : xm)}" y1="${y(l.y)}" y2="${y(l.y)}" class="limit"/>`);
  for (const s of spec.series) {
    if (!s.pts.length) continue;
    const dpath = s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
    g.push(`<path d="${dpath}" class="ser${s.dash ? ' dash' : ''}${s.limit ? ' need' : ''}" style="stroke:${s.color}"/>`);
  }
  g.push('</g>');
  // limit labels sit above their line (below if there is no room)
  for (const l of spec.limits || []) {
    const above = y(l.y) - T > 16;
    const failLeft = spec.fail && x(spec.fail.t) < L + pw * 0.5; // keep the limit label clear of the failure label
    g.push(`<text x="${failLeft ? L + pw - 6 : L + 6}" y="${above ? y(l.y) - 6 : y(l.y) + 16}" class="limlbl" text-anchor="${failLeft ? 'end' : 'start'}">${l.label}</text>`);
  }
  if (spec.fail) {
    const fx = x(spec.fail.t); const fy = Math.max(T + 4, Math.min(baseY - 4, y(spec.fail.y)));
    g.push(`<circle cx="${fx}" cy="${fy}" r="7" class="failpt"/>`);
    const right = fx < L + pw * 0.5;
    g.push(`<text x="${right ? fx + 12 : fx - 12}" y="${fy < T + 24 ? fy + 18 : fy - 12}" class="faillbl" text-anchor="${right ? 'start' : 'end'}">${spec.fail.label}</text>`);
  }
  g.push(`<line class="xhair" x1="0" x2="0" y1="${T}" y2="${baseY}" style="display:none"/>`);
  g.push(`<rect class="hit" x="${L}" y="${T}" width="${pw}" height="${ph}"/>`);
  return `<div class="plot"><svg viewBox="0 0 ${W} ${H}" data-chart="${id}" role="img" aria-label="${spec.title}: ${spec.verdict}">${g.join('')}</svg><div class="tip" hidden></div></div>`;
}

function barsSVG(spec) {
  const rows = spec.rows; const rowH = 34; const top = 6; const left = 124;
  const h = top + rows.length * rowH + 28; const pw = W - left - RM;
  const end = spec.xMax;
  const xMax = niceMax(Math.max(end * 1.3, ...rows.map((r) => Math.min(r.life, end * 1.8))));
  const x = (t) => left + (pw * Math.min(t, xMax)) / xMax;
  const g = [];
  rows.forEach((r, i) => {
    const yy = top + i * rowH; const bad = r.life < r.need;
    g.push(`<text x="${left - 8}" y="${yy + 19}" class="ytick">${r.name}</text>`);
    g.push(`<rect x="${left}" y="${yy + 6}" width="${Math.max(3, x(r.life) - left)}" height="16" rx="3" style="fill:${bad ? 'var(--red)' : BLUE}"/>`);
    g.push(`<line x1="${x(r.need)}" x2="${x(r.need)}" y1="${yy + 1}" y2="${yy + 27}" class="needline"/>`);
    if (bad) {
      const tx = x(r.life) + 6;
      g.push(`<text x="${Math.min(tx, W - RM)}" y="${yy + 19}" class="faillbl" text-anchor="${tx > W - 90 ? 'end' : 'start'}">dies yr ${r.life}</text>`);
    }
  });
  const by = top + rows.length * rowH;
  g.push(`<line x1="${x(end)}" x2="${x(end)}" y1="${top - 2}" y2="${by}" class="limit"/>`);
  g.push(`<text x="${x(end)}" y="${by + 16}" class="limlbl" text-anchor="middle">mission ends</text>`);
  return `<div class="plot"><svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${spec.verdict}">${g.join('')}</svg></div>`;
}

function timelineSVG(spec) {
  const { cruise, deadline } = spec; const h = 92; const L0 = 14; const pw = W - L0 - 20;
  const xMax = niceMax(Math.max(cruise, deadline) * 1.2);
  const x = (t) => L0 + (pw * Math.min(t, xMax)) / xMax;
  const g = [];
  const late = cruise > deadline;
  g.push(`<rect x="${L0}" y="40" width="${Math.max(3, x(late ? deadline : cruise) - L0)}" height="18" rx="3" style="fill:${BLUE}"/>`);
  if (late) g.push(`<rect x="${x(deadline)}" y="40" width="${x(cruise) - x(deadline)}" height="18" rx="3" style="fill:var(--red)"/>`);
  g.push(`<line x1="${x(deadline)}" x2="${x(deadline)}" y1="30" y2="68" class="needline"/>`);
  g.push(`<text x="${x(deadline)}" y="22" class="limlbl" text-anchor="${x(deadline) > W * 0.6 ? 'end' : 'start'}">Deadline: ${fmtYr(deadline)}</text>`);
  g.push(`<line x1="${L0}" x2="${L0 + pw}" y1="68" y2="68" class="axis"/>`);
  g.push(`<text x="${L0}" y="84" class="xtick" text-anchor="start">launch</text>`);
  g.push(`<text x="${x(cruise)}" y="84" class="${late ? 'faillbl' : 'xtick'}" text-anchor="${x(cruise) > W - 70 ? 'end' : 'middle'}">arrive ${fmtYr(cruise)}</text>`);
  return `<div class="plot"><svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${spec.verdict}">${g.join('')}</svg></div>`;
}

// Crosshair + readout on hover/touch.
export function attachHover(root) {
  const move = (e) => {
    const svg = e.target.closest && e.target.closest('svg[data-chart]'); if (!svg) return;
    const spec = REG.get(svg.dataset.chart); if (!spec || !spec._geo) return;
    const { L: l, pw } = spec._geo;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    const x0 = spec.xMin || 0;
    const t = Math.max(x0, Math.min(spec.xMax, x0 + ((p.x - l) / pw) * (spec.xMax - x0)));
    const xh = svg.querySelector('.xhair'); xh.style.display = ''; xh.setAttribute('x1', p.x); xh.setAttribute('x2', p.x);
    const vals = spec.series.filter((s) => !s.aux).map((s) => {
      const v = interp(s.pts, t);
      return v == null ? '' : `<div><i class="${s.dash ? 'dash' : ''}" style="--c:${s.color}"></i>${s.name}: <b>${spec.fmt(v)}</b></div>`;
    }).join('');
    const tip = svg.parentElement.querySelector('.tip');
    tip.hidden = false;
    tip.innerHTML = `<div class="tip-t">${spec.xUnit === 'day' ? `Day ${t.toFixed(1)}` : spec.xMin ? `${(t - x0).toFixed(2)} yr at ${spec.dest}` : `Year ${t.toFixed(t < 1 ? 2 : 1)}${spec.cruise != null && t < spec.cruise ? ' · trip' : ''}`}</div>${vals}`;
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
