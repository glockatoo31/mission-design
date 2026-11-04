import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './style.css';
import { DESTINATIONS, CONTRACTS, PAYLOADS, PARAMS, STEPS, FLYBYS } from './data.js';
import {
  budgets, budgetMargins, parts, simulate, explain, launchConditions, teamCode, ESTIMATE, paramVal,
  isComplete, cheapestFull, mulberry32, launchCapacity, fmtYr, fmtGb,
} from './model.js';
import {
  SUBS, SUB_LABEL, POWER_USERS, MIN_RESERVE, COST_STEP, POWER_STEP, fixedCost, fixedPower, costPool, defaultAlloc, fitAlloc,
  costReserve, powerRequired, compliance, requirements, reqFor,
} from './syseng.js';
import { consideration } from './considerations.js';
import {
  buildCharts, renderChart, resetCharts, attachHover, chartForFailure, CHART_ORDER, CHART_LABEL,
} from './charts.js';
import { COUPLING, BUDGET_LABEL, couplingMap } from './coupling.js';
import { ICON, MARK } from './icons.js';
import { craftSVG } from './craft.js';
import { createScene } from './scene.js';

// ---------- flags + state ----------
const query = new URLSearchParams(location.search);
const DEBUG = query.has('debug');
// ?demo: three contracts, three different traps (deadline + battery, dust storm + mass, radiation + power).
const DEMO_IDS = query.has('demo') ? ['lunar-survey', 'mars-survey', 'europa-spec'] : null;
const URL_SEED = query.has('seed') ? Math.abs(parseInt(query.get('seed'), 10)) || 1 : null;
const STORE = 'mission-design-v4';

// Contract, then its requirements, then the Flight Director allocates the budgets. Each lead
// designs inside their allocation: the bus, then route and propulsion (both depend on the
// target), then the rocket, which is picked last with the bus mass locked in.
const FLOW = ['contract', 'reqs', 'alloc', ...STEPS.map((s) => s.key), 'review', 'launch'];
const STEP = Object.fromEntries(STEPS.map((s) => [s.key, s]));
const STEP_NAME = { contract: 'Contract', reqs: 'Requirements', alloc: 'Allocation', review: 'Review', launch: 'Launch' };
// Which allocation each design screen draws on.
const OWNER = { power: 'pt', thermal: 'pt', comms: 'comms', traj: 'prop', engine: 'prop', tank: 'prop', launcher: 'launch' };
const stepName = (k) => STEP_NAME[k] || STEP[k].label;

// Silos: each screen shows only the budgets it governs (plus total cost and mass).
// The whole dashboard waits for the review, where the subsystems get integrated.
const SCREEN_CHARTS = {
  power: ['power', 'night'], thermal: ['thermal', 'rad'], comms: ['data'],
  traj: ['time', 'dv'], engine: ['dv', 'time'], tank: ['dv'], launcher: ['mass'],
};

// Who holds the phone on each screen.
const ROLE = {
  power: 'Power & Thermal Lead', thermal: 'Power & Thermal Lead', comms: 'Comms Lead',
  traj: 'Propulsion & Trajectory Lead', engine: 'Propulsion & Trajectory Lead', tank: 'Propulsion & Trajectory Lead',
};
const roleBadge = (k) => (ROLE[k] ? `Pass phone → ${ROLE[k]}` : 'Role: Flight Director');

const blank = () => ({
  contract: null, engine: null, traj: null, launcher: null, alloc: null, cr: {},
  ...Object.fromEntries(Object.entries(PARAMS).map(([k, p]) => [k, p.def])),
});
const fresh = () => ({ step: 0, design: blank(), attempt: 1, seed: URL_SEED ?? 1000 + Math.floor(Math.random() * 9000), history: [] });

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (!s || !s.design || typeof s.step !== 'number') return null;
    if (URL_SEED != null && s.seed !== URL_SEED) return null;
    return s;
  } catch { return null; }
}
let state = load() || fresh();
let ripple = null; // budgets the last change moved (attempt 2+)
let dragBefore = null; // margins when a slider drag started
let anim = null; // running launch animation handle
let speed = 1; // launch playback speed (2x toggle, attempt 2+)
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode */ } };

const $app = document.getElementById('app');
attachHover($app);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const R = Math.round;
const n1 = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const contract = () => CONTRACTS.find((c) => c.id === state.design.contract);
const dest = () => DESTINATIONS.find((x) => x.id === contract().dest);
const key = () => FLOW[state.step];

// First attempt: no budgets and no going back. Commit, launch, learn from the failure.
const showBudgets = () => state.attempt > 1;
const canGoBack = () => state.attempt > 1;

// ---------- budget chips + graphs (attempt 2+) ----------
function charts() { return isComplete(state.design) ? buildCharts(state.design, ESTIMATE) : null; }

function graphsInner(ch, screen) {
  return [...new Set([...SCREEN_CHARTS[screen], 'cost', 'mass'])].filter((k) => ch[k]).map((k) => renderChart(ch[k])).join('');
}

// ---------- coupling: what a choice feeds, and what the last change moved ----------
// Margins past ±100% are "plenty" / "hopeless": clamp so only real shifts show up.
const clampM = (m) => (typeof m === 'number' ? Math.max(-1, Math.min(1, m)) : m);
const margins = () => { const ch = charts(); return ch ? Object.fromEntries(Object.entries(ch).map(([k, v]) => [k, clampM(v.margin)])) : null; };
const fmtM = (m) => (m == null ? '–' : m >= 1 ? '100%+' : m <= -1 ? '−100%' : `${m < 0 ? '−' : ''}${Math.abs(R(m * 100))}%`);

function computeRipple(before, after) {
  if (!before || !after) return null;
  return Object.keys(after).filter((k) => typeof before[k] === 'number' && typeof after[k] === 'number' && Math.abs(after[k] - before[k]) >= 0.03)
    .sort((a, b) => Math.abs(after[b] - before[b]) - Math.abs(after[a] - before[a])).slice(0, 4)
    .map((k) => ({ k, from: before[k], to: after[k] }));
}

function rippleHTML() {
  if (!showBudgets() || !ripple) return '';
  if (!ripple.length) return '<div class="ripple"><b>That change barely moved any budget.</b></div>';
  return `<div class="ripple"><b>That change moved:</b>${ripple.map((r) => `<span class="rchip ${r.to < 0.15 && r.to < r.from ? 'down' : r.from < 0.15 && r.to >= 0.15 ? 'up' : ''}">${CHART_LABEL[r.k]} <i>${fmtM(r.from)}</i> → <i>${fmtM(r.to)}</i></span>`).join('')}</div>
    <p class="note">Margin left. Same choice, many budgets.</p>`;
}

// What each choice node in the coupling map says about your design.
const partName = (c) => {
  const d = state.design; const P = parts(d);
  if (c === 'contract') return P.payload ? P.payload.name : '';
  if (c === 'traj') return d.traj === 'assist' ? 'Assist' : d.traj ? 'Direct' : '';
  if (c === 'engine') return P.engine ? P.engine.name.replace(/\s*\(.*\)/, '') : '';
  if (c === 'launcher') return P.launcher ? P.launcher.name : '';
  return P[c].short;
};

// ---------- option cards (engine, route, rocket) ----------
function statsFor(stepKey, p) {
  const D = dest(); const d = state.design; const s = [];
  const add = (k, v) => s.push(`<span class="stat"><b>${v}</b> ${k}</span>`);
  if (p.mass != null) add('kg', p.mass);
  if (p.cost != null) add('', `$${p.cost}M`);
  if (stepKey === 'engine') { add('Isp (s)', p.isp); add('thrust', p.thrustN >= 400 ? 'High' : p.thrustN >= 50 ? 'Medium' : 'Tiny'); if (p.powerW) add('W to run', p.powerW); }
  if (stepKey === 'launcher') add(`kg to ${D.name}`, R(launchCapacity(p, D.traj[d.traj || 'direct'].c3)));
  if (stepKey === 'traj') {
    const tr = D.traj[p.id];
    add('yr trip', fmtYr(tr.cruise, true)); add('m/s burn', tr.dv);
    add('launch energy', tr.c3 > 30 ? 'High' : tr.c3 > 10 ? 'Med' : 'Low');
    add('ops cost', `$${R(D.opsCostPerYr * (tr.cruise + D.opsYears))}M`);
    if (tr.flyby) add('', FLYBYS[tr.flyby].name);
  }
  if (p.life != null) add('yr life', p.life);
  return s.join('');
}

function optionsHTML(step) {
  const D = dest(); const cur = state.design[step.key];
  const list = step.key === 'traj' ? step.list.map((t) => ({ ...t, name: t.id === 'assist' ? `Assist: ${D.traj.assist.label}` : 'Direct' })) : step.list;
  return `<div class="opts">${list.map((p) => `
      <button class="opt ${cur === p.id ? 'sel' : ''}" data-act="pick" data-slot="${step.key}" data-id="${p.id}">
        <div class="opt-name">${esc(p.name)}</div><div class="opt-blurb">${esc(p.blurb)}</div>
        <div class="stats">${statsFor(step.key, p)}</div>
      </button>`).join('')}</div>`;
}

// ---------- sliders (power, thermal, antenna, fuel) ----------
const fmtV = (v, p) => `${n1(v)}${p.unit ? ` ${p.unit}` : ''}`;

function slidersHTML(step) {
  const D = dest();
  const keys = step.params.filter((k) => k !== 'battery' || D.nightHours);
  return `<div class="sliders">${keys.map((k) => {
    const p = PARAMS[k]; const v = paramVal(state.design, k);
    return `<div class="slider"><div class="s-head"><label for="sl-${k}">${p.label}</label><output id="out-${k}" class="s-val">${fmtV(v, p)}</output></div>
      <input id="sl-${k}" type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}" data-key="${k}">
      <div class="s-scale"><span>${fmtV(p.min, p)}</span><span>${fmtV(p.max, p)}</span></div></div>`;
  }).join('')}<div class="stats live" id="live">${liveStats(step.key)}</div></div>`;
}

// The part's own numbers as you size it: mass, cost, and what it does at this destination.
function liveStats(k) {
  const D = dest(); const P = parts(state.design); const s = [];
  const add = (u, v) => s.push(`<span class="stat"><b>${v}</b> ${u}</span>`);
  const part = P[k];
  add('kg', R(part.mass)); add('', `$${R(part.cost)}M`);
  if (k === 'power') {
    const w = part.solarW * Math.min(1 / D.sunAU ** 2, D.solarCap) + part.rtgW;
    add(`W at ${D.name}`, w >= 10 ? R(w) : w.toFixed(1));
    if (D.nightHours) add('kWh battery', n1(part.batteryWh / 1000));
  } else if (k === 'thermal') {
    add('x sun max', n1(part.hotLimit)); add('krad shield', R(part.radTol));
    const heat = D.coldW * part.heaterFactor; if (heat > 0) add('W heater here', R(heat));
  } else if (k === 'comms') {
    const down = (part.rateGb * D.contact) / (D.earthAU * D.earthAU);
    add('W from bus', part.powerW); add('x sun heat', part.heatFlux.toFixed(2)); add(`Gbit/yr from ${D.name}`, down >= 100 ? R(down) : down.toFixed(1));
  } else if (k === 'tank') add('kg fuel', R(part.prop));
  return s.join('');
}

// ---------- screens ----------
function header() {
  const n = state.step;
  return `<header class="top">
    <div class="top-row"><div class="brand">${MARK}Mission Design${DEBUG ? ' <span class="dbg">debug</span>' : ''}</div><span class="attempt">Attempt ${state.attempt}</span></div>
    <div class="countdown"><b>${n === FLOW.length - 1 ? 'T+0' : `T−${FLOW.length - 1 - n}`}</b> · ${stepName(key())} <span class="role-badge">${roleBadge(key())}</span></div>
    <i class="prog" style="width:${(100 * n) / (FLOW.length - 1)}%"></i>
  </header>`;
}

function canNext() {
  const d = state.design; const k = key();
  if (k === 'contract') return !!d.contract;
  if (k === 'alloc') return costReserve(d, contract()) >= minReserve();
  if (k === 'power') return paramVal(d, 'solarArea') > 0 || paramVal(d, 'rtgUnits') > 0;
  if (k === 'traj' || k === 'engine' || k === 'launcher') return !!d[k];
  return true;
}

function nav(canGo, nextLabel = 'Next') {
  const back = canGoBack() && state.step > 0;
  const lock = !canGoBack() && state.step > 0 ? '<span class="lock">No going back on the first attempt</span>' : '<span></span>';
  return `<nav class="bottom">
    ${back ? '<button class="btn ghost" data-act="back">Back</button>' : lock}
    <button class="btn primary" data-act="next" ${canGo ? '' : 'disabled'}>${nextLabel}</button>
  </nav>`;
}

function debugBar() {
  if (!DEBUG || !state.design.contract || key() === 'review' || key() === 'launch') return '';
  return `<div class="debugbar"><button class="btn small" data-act="dbg-random">Random design</button><button class="btn small" data-act="dbg-good">Cheapest full success</button><span>seed ${state.seed}</span></div>`;
}

function screenContract() {
  const sel = state.design.contract;
  const cards = CONTRACTS.filter((C) => !DEMO_IDS || DEMO_IDS.includes(C.id)).map((C) => {
    const D = DESTINATIONS.find((x) => x.id === C.dest); const pay = PAYLOADS.find((x) => x.id === C.payload);
    return `<button class="dest ${sel === C.id ? 'sel' : ''}" data-act="contract" data-id="${C.id}">
      <div class="dest-top"><span class="planet" style="--c:${D.color}"></span>
        <div><div class="dest-name">${esc(C.name)}</div><div class="diff" role="img" aria-label="Difficulty ${D.difficulty} of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= D.difficulty ? 'on' : ''}"></i>`).join('')}</div></div>
        <span class="mult">×${D.mult} score</span></div>
      <div class="dest-goal">${esc(C.brief)}</div>
      <div class="kv"><span>Instrument</span><b>${esc(pay.name)}</b></div>
      <div class="kv"><span>Science goal</span><b>${C.goalGb} Gbit</b></div>
      <div class="kv"><span>Arrive within</span><b>${fmtYr(C.deadline)}</b></div>
      <div class="kv"><span>Funding</span><b>$${C.budget}M</b></div>
      <div class="hazard">${ICON.alert}<span>${esc(D.hazard.name)}</span></div>
    </button>`;
  }).join('');
  const intro = state.attempt === 1
    ? '<p class="lead">Accept a contract. It fixes the target, the instrument, the deadline and the funding. One choice per screen after this, and no going back.</p>'
    : '<p class="lead">Take the same contract again, or switch.</p>';
  return `${header()}<main><h1>Contract board</h1>${intro}
    ${state.history.length ? historyHTML() : ''}<div class="dests">${cards}</div>
    <button class="link" data-act="reset">Start over (new team)</button></main>${nav(!!sel)}`;
}

// ---------- requirements and allocation (Flight Director) ----------
const f$ = (v) => `$${R(v)}M`;
const fW = (v) => `${R(v)} W`;
const fPct = (m) => (typeof m === 'number' ? `${m < 0 ? '−' : '+'}${Math.min(999, Math.abs(R(m * 100)))}%` : '–');
const minReserve = () => Math.ceil(MIN_RESERVE * contract().budget);

function screenReqs() {
  const rows = requirements(state.design);
  return `${header()}<main><h1>Requirements</h1>
    <p class="lead">The contract, as testable requirements. Each has an owner and a trace to the choices that satisfy it. At Review you verify every one.</p>
    <div class="reqs">${rows.map((r) => `<div class="req"><b class="rid">${r.id}</b><div><div class="rtext">${esc(r.text)}</div><div class="rmeta">Owner: ${r.owner}</div><div class="rmeta">Satisfied by: ${r.by}</div></div></div>`).join('')}</div>
  </main>${nav(true)}`;
}

function allocSlider(kind, id, label, max, step, fmt) {
  const v = state.design.alloc[kind][id];
  return `<div class="slider"><div class="s-head"><label for="al-${kind}-${id}">${label}</label><output id="ao-${kind}-${id}" class="s-val">${fmt(v)}</output></div>
    <input id="al-${kind}-${id}" type="range" min="0" max="${max}" step="${step}" value="${v}" data-alloc="${kind}.${id}"></div>`;
}

function allocSummary() {
  const d = state.design; const C = contract();
  const alloc = SUBS.reduce((s, x) => s + d.alloc.cost[x.id], 0); const res = costReserve(d, C); const min = minReserve();
  return `<div class="costbox"><div class="kv"><span>Funding cap</span><b>${f$(C.budget)}</b></div>
    <div class="kv"><span>Fixed: bus + instrument</span><b>${f$(fixedCost(C))}</b></div>
    <div class="kv"><span>Allocated to the four owners</span><b>${f$(alloc)}</b></div>
    <div class="kv total"><span>Reserve (keep at least ${f$(min)})</span><b class="${res < min ? 'red-t' : ''}">${f$(res)}</b></div>
    <div class="kv"><span>Power system must supply</span><b>${fW(powerRequired(d, C))}</b></div></div>
    ${res < min ? `<div class="warn">Hold back at least ${f$(min)} as reserve. It pays for change requests later.</div>` : ''}`;
}

function screenAlloc() {
  const C = contract(); const max = Math.floor(costPool(C) / COST_STEP) * COST_STEP;
  return `${header()}<main><h1>Allocate the budgets</h1>
    <p class="lead">Flight Director: split cost between the four owners, and the power each may draw. What you do not allocate is reserve. Each lead then designs inside their share, and the power system is sized to cover every allocated load.</p>
    <section class="slot"><h2>Cost</h2><div class="sliders">${SUBS.map((s) => allocSlider('cost', s.id, s.label, max, COST_STEP, f$)).join('')}</div></section>
    <section class="slot"><h2>Power draw</h2><div class="sliders">${POWER_USERS.map((id) => allocSlider('power', id, { pt: 'Heaters (Power & Thermal)', comms: 'Transmitter (Comms)', prop: 'Ion engine (Propulsion)' }[id], 400, POWER_STEP, fW)).join('')}</div>
      <p class="note">Bus and instrument draw ${fW(fixedPower(C))} on top of this.</p></section>
    <div id="alloc-sum">${allocSummary()}</div>
  </main>${nav(canNext())}`;
}

// "Your allocation" panel on each design screen. Attempt 1 shows the numbers only;
// attempt 2+ adds used vs allocated bars.
function allocPanel(k) {
  const d = state.design; const sub = OWNER[k]; if (!d.alloc) return '';
  const cf = compliance(d); const live = showBudgets();
  const row = (label, r, fmt) => {
    if (!r) return '';
    const pct = Math.min(100, r.alloc > 0 ? (100 * r.used) / r.alloc : r.used > 0 ? 100 : 0);
    return `<div class="a-row ${live && r.over ? 'over' : ''}"><div class="kv"><span>${label}</span><b>${live ? `${fmt(r.used)} of ${fmt(r.alloc)}` : `${fmt(r.alloc)} allocated`}</b></div>
      ${live ? `<i class="a-bar"><u style="width:${pct}%"></u></i>` : ''}${live && r.over ? `<small>Over by ${fmt(r.over)}. Needs a change request at Review, or cut.</small>` : ''}</div>`;
  };
  const supply = k === 'power' ? `<div class="a-row ${live && cf.short ? 'over' : ''}"><div class="kv"><span>Supply must cover</span><b>${fW(cf.required)}${live ? ` · yours ${fW(cf.supply)}` : ''}</b></div>${live && cf.short ? '<small>Short. Add arrays or RTG, or ask for lower allocations.</small>' : ''}</div>` : '';
  return `<h2>${SUB_LABEL[sub]}: your allocation</h2>${row('Cost', cf.rows.find((r) => r.key === `cost.${sub}`), f$)}${row('Power draw', cf.rows.find((r) => r.key === `power.${sub}`), fW)}${supply}`;
}

function screenChoice(k) {
  const step = STEP[k]; const D = dest();
  const c = consideration(k, D, state.design);
  const ch = showBudgets() ? charts() : null;
  return `${header()}<main>${debugBar()}
    <section class="consider">
      <div class="eyebrow"><span class="role">${step.role}</span></div>
      <h1>${esc(c.title)}</h1>
      <p class="why">${esc(c.why)}</p>
      <ul class="here">${c.here.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
      <div class="feeds"><span>Ripples into</span>${COUPLING[k].map((b) => `<i>${BUDGET_LABEL[b]}</i>`).join('')}</div>
    </section>
    <section class="alloc" id="alloc">${allocPanel(k)}</section>
    <div class="craft-wrap" id="craft">${craftSVG(state.design, { screen: k })}</div>
    ${step.params ? slidersHTML(step) : optionsHTML(step)}
    <div id="rip">${rippleHTML()}</div>
    ${ch ? `<section class="graphs"><h2>Your budgets</h2><p class="note">Your subsystem, plus total cost and mass. Blue is your design, orange the limit. Nominal margins: no mass growth, no anomaly. The whole dashboard is at Review.</p><div class="chart-grid" id="chart-grid">${graphsInner(ch, k)}</div></section>` : ''}
  </main>${nav(canNext())}`;
}

// Slider moves update only the readouts and graphs, never the sliders themselves.
function refreshDynamic() {
  const k = key(); const step = STEP[k];
  const ch = showBudgets() ? charts() : null;
  resetCharts();
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  if (ch) set('chart-grid', graphsInner(ch, k));
  if (step && step.params) set('live', liveStats(k));
  set('alloc', allocPanel(k));
  set('craft', craftSVG(state.design, { screen: k }));
  set('rip', rippleHTML());
  const next = document.querySelector('[data-act=next]'); if (next) next.disabled = !canNext();
}

function screenReview() {
  const d = state.design;
  if (!isComplete(d)) return `${header()}<main><h1>Design review</h1><p>Some parts are missing.</p></main>${nav(false)}`;
  const b = budgets(d, ESTIMATE); const C = b.C; const P = b.P;
  const rows = [
    ['Contract', C.name], ['Power', P.power.name], ['Thermal', P.thermal.name], ['Antenna', P.comms.name],
    ['Route', d.traj === 'assist' ? `Assist: ${b.D.traj.assist.label}` : 'Direct'], ['Engine', P.engine.name], ['Fuel', P.tank.name], ['Rocket', P.launcher.name],
  ].map(([a, v]) => `<div class="kv"><span>${a}</span><b>${esc(v)}</b></div>`).join('');
  if (!showBudgets()) {
    return `${header()}<main><h1>Final design</h1><p class="lead">${esc(C.name)}. Launch it and see what happens.</p>
      <div class="craft-wrap">${craftSVG(d)}</div>
      <div class="costbox">${rows}</div>
    </main>${nav(true, 'Launch')}`;
  }
  const ch = buildCharts(d, ESTIMATE);
  const keys = CHART_ORDER.filter((k) => ch[k]);
  const reqs = requirements(d); const cf = compliance(d);
  const reds = reqs.filter((r) => r.status === 'red').length; const yellows = reqs.filter((r) => r.status === 'yellow').length;
  const over = b.cost > b.budget;
  const ready = !over && cf.ok;
  const own = (r) => `${SUB_LABEL[r.sub]} · ${r.kind === 'cost' ? 'cost' : 'power'}`;
  const fmt = (r) => (r.kind === 'cost' ? f$ : fW);
  const crButton = (r) => {
    if (!r.over) return '';
    const ok = r.kind === 'power' || cf.reserve >= r.over;
    return `<button class="btn small" data-act="cr" data-k="${r.key}" data-amt="${r.over}" ${ok ? '' : 'disabled'}>${r.kind === 'cost' ? `Change request +${f$(r.over)} from reserve` : `Change request +${fW(r.over)}`}</button>`;
  };
  const allocRows = cf.rows.filter((r) => r.alloc > 0 || r.used > 0).map((r) => `<div class="vrow ${r.over ? 'red' : 'green'}"><div><div>${own(r)}</div><small>${fmt(r)(r.used)} used of ${fmt(r)(r.alloc)}</small></div>${crButton(r)}</div>`).join('');
  return `${header()}<main><h1>Design review</h1>
    <div class="craft-wrap">${craftSVG(d)}</div>
    <h2>Requirements verification</h2>
    <div class="summary">${reds ? `<b class="red-t">${reds} failing</b> · ` : ''}${yellows ? `<b class="yellow-t">${yellows} thin</b> · ` : ''}${!reds && !yellows ? '<b class="green-t">All verified</b>' : ''}</div>
    <div class="verify">${reqs.map((r) => `<div class="vrow ${r.status}"><b class="rid">${r.id}</b><div><div>${esc(r.text)}</div><small>${r.owner} · ${r.by}</small></div><span class="r-m">${fPct(r.margin)}</span></div>`).join('')}</div>
    <div class="unlock">Nominal margins shown. Launch adds 0–15% dry-mass growth + 1 deep-space anomaly.</div>
    <h2>Budget allocations</h2>
    <div class="verify">${allocRows}
      <div class="vrow ${cf.reserve < 0 ? 'red' : cf.reserve < cf.minReserve ? 'yellow' : 'green'}"><div><div>Cost reserve</div><small>${f$(cf.reserve)} left. Change requests draw on it.</small></div></div>
      <div class="vrow ${cf.short ? 'red' : 'green'}"><div><div>Power system vs allocations</div><small>Must supply ${fW(cf.required)}. Yours gives ${fW(cf.supply)}.</small></div>${cf.short ? '<button class="btn small" data-act="realloc">Reallocate</button>' : ''}</div></div>
    <details class="picks"><summary>All budget graphs</summary><div class="chart-grid">${keys.map((k) => renderChart(ch[k])).join('')}</div></details>
    <details class="picks"><summary>Your design</summary><div class="costbox">${rows}</div></details>
    ${over ? `<div class="warn">Launch blocked: over budget by ${f$(b.cost - b.budget)}.</div>` : ''}
    ${!over && !cf.ok ? '<div class="warn">Launch blocked: an owner is over their allocation, or the power system does not cover the allocated loads. File change requests, redesign, or reallocate.</div>' : ''}
  </main>${nav(ready, 'Launch')}`;
}

function historyHTML() {
  return `<div class="history"><b>Past attempts</b>${state.history.map((h) => `<div class="h-row"><span>#${h.attempt} ${esc(h.name)}</span><span class="tier ${h.outcome}">${tierName(h.outcome)}</span><span>${h.score} pts</span><span class="code">${h.code}</span></div>`).join('')}</div>`;
}
const tierName = (o) => ({ none: 'No mission', min: 'Minimum', full: 'Full success' }[o]);

// ---------- launch screen ----------
function screenLaunch() {
  return `${header()}<main class="launch">
    <div id="banner"></div>
    ${state.attempt > 1 ? '<button class="btn small ff" data-act="ff" aria-pressed="false">2x &gt;&gt;</button>' : ''}
    <div class="phase-name" id="phase">Countdown</div>
    <div class="clock" id="clock">T-0</div>
    <div class="scene-wrap" id="scene"></div>
    <div class="track" id="track"></div>
    <div class="phases" id="phases"></div>
    <ul class="log" id="log"></ul>
    <div id="result"></div>
  </main>`;
}

function startLaunch() {
  const d = state.design;
  // Attempt 1 flies even over budget, so every team sees a real failure mode.
  const cond = { ...launchConditions(state.seed, state.attempt), bailout: state.attempt === 1 };
  const res = simulate(d, cond);
  if (res.b.cost > res.b.budget && cond.bailout) {
    document.getElementById('banner').innerHTML = `<div class="warn">Over budget by $${R(res.b.cost - res.b.budget)}M — emergency bailout granted for Attempt 1 flight test!</div>`;
  }
  const b = res.b; const cruise = b.tr.cruise; const end = cruise + b.D.opsYears;
  const f = res.failure;
  const stopT = f && !f.partial ? f.t : end;

  // Map mission time (years) to animation time (ms).
  // Skip timers in debug mode, or if this attempt already flew (page was reloaded).
  const instant = DEBUG || state.history.some((h) => h.attempt === state.attempt);
  const P = instant ? { lift: 0, cruise: 0, arr: 0, ops: 0 } : { lift: 4000, cruise: 13000, arr: 4000, ops: 8000 };
  const tOf = (t, phase) => {
    if (phase === 'launch') return P.lift * 0.85;
    if (phase === 'review') return 0;
    if (phase === 'arrival') return P.lift + P.cruise + P.arr * 0.7;
    if (phase === 'cruise' || (t < cruise && phase !== 'ops')) return P.lift + P.cruise * (cruise > 0 ? t / cruise : 1);
    return P.lift + P.cruise + P.arr + P.ops * ((t - cruise) / Math.max(0.001, end - cruise));
  };
  const totalMs = P.lift + P.cruise + P.arr + P.ops;

  const beats = [];
  if (!(f && f.phase === 'review')) beats.push({ ms: P.lift * 0.85, cls: f && f.mode === 'launcher' ? 'fail' : 'ok', text: f && f.mode === 'launcher' ? f.text : `Liftoff on ${b.P.launcher.name}. ${R(b.wet)} kg away.`, fail: f && f.mode === 'launcher' });
  for (const e of res.events) {
    const phase = e.kind === 'arrival' ? 'arrival' : e.t < cruise ? 'cruise' : 'ops';
    if (e.kind === 'arrival') continue;
    beats.push({ ms: tOf(e.t, phase), cls: e.kind === 'random' ? 'info' : 'warn', text: `${e.kind === 'random' ? 'Event' : e.kind === 'flyby' ? 'Flyby' : 'Hazard'}: ${e.text}`, t: e.t });
  }
  if (!f || f.partial || (f.t >= cruise && f.phase === 'ops')) beats.push({ ms: tOf(cruise, 'arrival'), cls: 'ok', text: `Arrival burn: ${R(b.dvAvail)} of ${R(b.dvReq)} m/s. In position at ${b.D.name}.` });
  if (f && f.mode !== 'launcher') beats.push({ ms: f.partial ? totalMs : tOf(f.t, f.phase), cls: f.partial ? 'warn' : 'fail', text: f.text, fail: !f.partial });
  if (!f) beats.push({ ms: totalMs, cls: 'ok', text: `Mission complete: ${fmtGb(res.scienceGb)} returned.` });
  beats.sort((a, b2) => a.ms - b2.ms);
  const stopMs = f && !f.partial ? Math.min(...beats.filter((x) => x.fail).map((x) => x.ms)) : totalMs;

  // Static track with year ticks and markers.
  const track = document.getElementById('track');
  const years = Math.ceil(end);
  const pos = (t) => `${(100 * t) / end}%`;
  const marks = res.events.filter((e) => e.kind !== 'arrival').map((e) => `<span class="mk ${e.kind}" style="left:${pos(e.t)}" title="${esc(e.text)}"></span>`).join('');
  const ticks = Array.from({ length: years + 1 }, (_, i) => (i <= end ? `<span class="tick" style="left:${pos(i)}">${end > 12 && i % 2 ? '' : i}</span>` : '')).join('');
  track.innerHTML = `<div class="bar"><div class="cruise-zone" style="width:${pos(cruise)}"></div><div class="fill" id="fill"></div>${marks}<span class="mk arrival" style="left:${pos(cruise)}"></span>${f && !f.partial ? `<span class="mk failmk" id="failmk" style="left:${pos(Math.min(end, f.t))}; display:none"></span>` : ''}</div><div class="ticks">${ticks}</div><div class="track-legend"><span>Cruise</span><span>Operations</span><span>years</span></div>`;
  document.getElementById('phases').innerHTML = ['Liftoff', 'Cruise', 'Arrival', 'Operations'].map((p, i) => `<span id="ph${i}">${p}</span>`).join('');

  const log = document.getElementById('log');
  const scene = createScene(document.getElementById('scene'), { design: d, b, failure: f });
  const phaseStart = [0, P.lift, P.lift + P.cruise, P.lift + P.cruise + P.arr]; const phaseLen = [P.lift, P.cruise, P.arr, P.ops];
  const finalPose = () => (!f || f.partial ? { ph: 3, p: 1 }
    : f.phase === 'review' ? { ph: 0, p: 0 } : f.phase === 'launch' ? { ph: 0, p: 0.85 }
      : f.phase === 'cruise' ? { ph: 1, p: f.t / cruise } : f.phase === 'arrival' ? { ph: 2, p: 0.7 } : { ph: 3, p: (f.t - cruise) / (end - cruise) });
  // Virtual clock so the 2x toggle can change speed mid-flight.
  let next = 0; let clock = 0; let last = performance.now(); speed = 1;
  const phaseAt = (ms) => (ms < P.lift ? 0 : ms < P.lift + P.cruise ? 1 : ms < P.lift + P.cruise + P.arr ? 2 : 3);
  const missionT = (ms) => {
    if (ms < P.lift) return 0;
    if (ms < P.lift + P.cruise) return cruise * ((ms - P.lift) / P.cruise);
    if (ms < P.lift + P.cruise + P.arr) return cruise;
    return cruise + (end - cruise) * Math.min(1, (ms - P.lift - P.cruise - P.arr) / P.ops);
  };

  function frame(now) {
    clock += (now - last) * speed; last = now;
    const ms = Math.min(clock, stopMs);
    const ph = phaseAt(ms);
    const tm = instant ? stopT : Math.min(missionT(ms), stopT);
    document.getElementById('phase').textContent = f && f.phase === 'review' ? 'Program review' : ['Liftoff', 'Cruise', 'Arrival burn', 'Operations'][ph];
    document.getElementById('clock').textContent = ph === 0 ? 'T+0' : `Year ${tm.toFixed(1)}`;
    document.getElementById('fill').style.width = pos(tm);
    for (let i = 0; i < 4; i++) document.getElementById(`ph${i}`).className = i < ph ? 'done' : i === ph ? 'now' : '';
    const pose = instant ? finalPose() : { ph, p: Math.min(1, (ms - phaseStart[ph]) / phaseLen[ph]) };
    scene.update({ ...pose, ms, dead: !!f && !f.partial && (instant || ms >= stopMs) });
    while (next < beats.length && beats[next].ms <= ms) {
      const bt = beats[next++];
      log.insertAdjacentHTML('afterbegin', `<li class="${bt.cls}">${bt.cls === 'ok' ? ICON.check : bt.cls === 'fail' ? ICON.x : bt.cls === 'warn' ? ICON.alert : ICON.info}<span>${esc(bt.text)}</span></li>`);
      if (bt.fail) { const fm = document.getElementById('failmk'); if (fm) fm.style.display = 'block'; document.querySelector('.launch').classList.add('shake'); }
    }
    // Timers (not requestAnimationFrame) so the launch keeps going if the phone is backgrounded.
    if (ms < stopMs) anim = setTimeout(() => frame(performance.now()), 33);
    else if (instant) { anim = null; showResult(res); }
    else anim = setTimeout(() => { anim = null; showResult(res); }, 900 / speed);
  }
  frame(performance.now());
}

function showResult(res) {
  if (key() !== 'launch' || !document.getElementById('result')) return;
  const d = state.design; const D = res.b.D; const C = res.b.C;
  const code = teamCode(d, state.seed, state.attempt);
  const first = state.attempt === 1;
  if (!state.history.find((h) => h.attempt === state.attempt)) {
    state.history.push({ attempt: state.attempt, name: C.name, outcome: res.outcome, score: res.score, code, cost: R(res.cost) });
    save();
  }
  const chains = explain(d, res);
  const f = res.failure;
  const closest = !f ? closestCall(res.b) : null;
  const ev = res.opts.event;
  // The graph of the budget that broke, flown with the real launch conditions.
  const ch = buildCharts(d, res.opts, f);
  const fk = chartForFailure(f, res.b);
  const failChart = ch && fk && ch[fk] ? renderChart(ch[fk]) : '';
  const map = f ? `<p class="a-sub">The failure traces back to these choices:</p>${couplingMap(d, partName, fk)}` : '';
  const later = f ? downstream(res, fk) : [];
  const warnLater = later.length ? `<div class="warn">Downstream Warning: Even if you survived ${fk ? CHART_LABEL[fk].toLowerCase() : 'that'}, this design also failed ${later.map((k) => CHART_LABEL[k].toLowerCase()).join(' and ')}.</div>` : '';
  const rq = f ? requirements(d).find((r) => r.id === reqFor(f)) : null;
  const overs = f ? compliance(d).rows.filter((r) => r.over > 0) : [];
  const reqLine = !rq ? '' : `<p class="a-req"><b>${rq.id} not met:</b> ${esc(rq.text)}. Owner: ${rq.owner}.</p>
      <p class="note">${overs.length ? `Allocation overruns: ${overs.map((r) => `${SUB_LABEL[r.sub]} +${r.kind === 'cost' ? f$(r.over) : fW(r.over)}`).join(', ')}. In a real program each needs a change request.` : 'Every owner stayed inside their allocation, so budget discipline was fine. The requirement itself was the problem.'}</p>`;
  document.getElementById('result').innerHTML = `
    <div class="outcome ${res.outcome}">
      <div class="o-tier">${tierName(res.outcome)}</div>
      <div class="o-grid">
        <div><span>Score</span><b>${res.score}</b></div>
        <div><span>Science</span><b>${fmtGb(res.scienceGb)}</b></div>
        <div><span>Cost</span><b>$${R(res.cost)}M</b></div>
        <div><span>Team code</span><b class="code">${code}</b></div>
      </div>
      <div class="o-note">${res.points} science pts × ${D.mult} (${esc(C.name)})</div>
      ${res.outcome !== 'none' ? `<div class="o-note">Your Cost: $${R(res.cost)}M | Target Par Cost: $${C.par}M</div>` : ''}
    </div>
    ${f ? `<section class="anomaly"><h2>Anomaly report</h2><p class="a-what">${esc(f.text)}</p>
      ${reqLine}${warnLater}
      ${failChart}
      ${map}
      <p class="a-sub">The chain of cause and effect:</p>
      ${chains.slice(0, 1).map((c) => `<ol class="chain">${c.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`).join('')}
      ${chains.length > 1 ? `<details class="picks"><summary>More causes</summary>${chains.slice(1).map((c) => `<ol class="chain">${c.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`).join('')}</details>` : ''}
      </section>` : `<section class="anomaly good"><h2>Mission report</h2><p>Every constraint held. ${closest ? `Closest call: <b>${closest}</b>.` : ''}</p></section>`}
    ${ev ? `<p class="note">Random event: ${esc(ev.text)}</p>` : ''}
    ${first ? `<div class="unlock"><b>Budgets unlocked.</b> Graphs on every screen. Back works now.</div>` : ''}
    ${historyHTML()}
    <div class="end-actions">
      <button class="btn primary" data-act="redesign">Redesign · Attempt ${state.attempt + 1}</button>
      <button class="btn ghost" data-act="newcontract">Change contract</button>
    </div>`;
  document.querySelector('.ff')?.remove();
  if (!DEBUG) document.getElementById('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Chief engineer's note: up to two other budgets that would also have killed this design,
// from later failures in the flight, then anything already broken on paper.
function downstream(res, fk) {
  const keys = (res.others || []).map((o) => chartForFailure(o, res.b));
  const M = budgetMargins(budgets(state.design, ESTIMATE));
  keys.push(...Object.keys(M).filter((k) => M[k] < 0));
  return [...new Set(keys)].filter((k) => k && k !== fk).slice(0, 2);
}

function closestCall(b) {
  const opts = [['Mass', b.massMargin], ['Power', b.powerMargin], ['Delta-v', b.dvMargin], ['Data', b.dataMargin], ['Thermal', b.thermalMargin], ['Radiation', b.radMargin], ['Cost', b.costMargin], ['Design life', b.lifeMargin], ['Schedule', b.timeMargin]];
  const m = opts.filter((x) => typeof x[1] === 'number').sort((a, c) => a[1] - c[1])[0];
  return m ? `${m[0]} margin ${R(m[1] * 100)}%` : null;
}

// ---------- render + events ----------
function render() {
  if (anim) { clearTimeout(anim); anim = null; }
  resetCharts();
  const k = key();
  let html = '';
  if (k === 'contract') html = screenContract();
  else if (k === 'reqs') html = screenReqs();
  else if (k === 'alloc') html = screenAlloc();
  else if (k === 'review') html = screenReview();
  else if (k === 'launch') html = screenLaunch();
  else html = screenChoice(k);
  $app.innerHTML = html;
  if (k === 'launch') startLaunch();
}

function go(n) { state.step = n; ripple = null; dragBefore = null; save(); render(); window.scrollTo(0, 0); }
const stepOf = (k) => FLOW.indexOf(k);

function autoPick(mode) {
  if (!state.design.contract) return;
  if (mode === 'good') {
    const best = cheapestFull(state.design.contract); if (best) state.design = { ...best.d, alloc: fitAlloc(best.d), cr: {} };
  } else {
    const rng = mulberry32(Date.now() & 0xffffffff);
    for (const [k, p] of Object.entries(PARAMS)) {
      const steps = Math.round((p.max - p.min) / p.step);
      state.design[k] = +(p.min + Math.floor(rng() * (steps + 1)) * p.step).toFixed(2);
    }
    if (!state.design.solarArea && !state.design.rtgUnits) state.design.solarArea = 8;
    for (const s of STEPS) if (s.list) state.design[s.key] = s.list[Math.floor(rng() * s.list.length)].id;
  }
  save(); render();
}

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  const keepScroll = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };
  if (act === 'contract') {
    state.design.contract = el.dataset.id;
    state.design.alloc = defaultAlloc(contract()); state.design.cr = {};
    save(); render();
  } else if (act === 'cr') {
    // Change request: the Flight Director approves it, and it draws on the reserve (cost) or grows the power the supply must cover.
    const d = state.design; const amt = +el.dataset.amt; const k = el.dataset.k;
    if (k.startsWith('cost.') && costReserve(d, contract()) < amt) return;
    d.cr = { ...d.cr, [k]: (d.cr[k] || 0) + amt };
    save(); keepScroll();
  } else if (act === 'realloc') go(stepOf('alloc'));
  else if (act === 'pick') {
    const before = showBudgets() ? margins() : null;
    state.design[el.dataset.slot] = el.dataset.id;
    ripple = computeRipple(before, showBudgets() ? margins() : null);
    save(); keepScroll();
  } else if (act === 'ff') {
    speed = speed === 1 ? 2 : 1;
    el.setAttribute('aria-pressed', String(speed === 2));
  } else if (act === 'next') {
    if (key() === 'contract' && DEBUG && !state.design.engine) autoPick('random');
    go(Math.min(FLOW.length - 1, state.step + 1));
  } else if (act === 'back') { if (canGoBack()) go(Math.max(0, state.step - 1)); }
  else if (act === 'redesign') { state.attempt += 1; go(stepOf('alloc')); }
  else if (act === 'newcontract') { state.attempt += 1; go(stepOf('contract')); }
  else if (act === 'reset') {
    if (confirm('Start over as a new team? This clears all attempts.')) { state = fresh(); save(); render(); }
  } else if (act === 'dbg-random') autoPick('random');
  else if (act === 'dbg-good') autoPick('good');
});

// Sliders: update the design and the readouts live, and show what moved when you let go.
$app.addEventListener('input', (e) => {
  const el = e.target;
  if (el.matches && el.matches('input[type=range][data-alloc]')) {
    const [kind, id] = el.dataset.alloc.split('.'); const v = parseFloat(el.value);
    state.design.alloc[kind][id] = v;
    document.getElementById(`ao-${kind}-${id}`).textContent = kind === 'cost' ? f$(v) : fW(v);
    document.getElementById('alloc-sum').innerHTML = allocSummary();
    document.querySelector('[data-act=next]').disabled = !canNext();
    save(); return;
  }
  if (!el.matches || !el.matches('input[type=range][data-key]')) return;
  const k = el.dataset.key;
  if (dragBefore === null && showBudgets()) dragBefore = margins();
  state.design[k] = parseFloat(el.value);
  const out = document.getElementById(`out-${k}`); if (out) out.textContent = fmtV(state.design[k], PARAMS[k]);
  save(); refreshDynamic();
});
$app.addEventListener('change', (e) => {
  const el = e.target; if (!el.matches || !el.matches('input[type=range][data-key]')) return;
  if (dragBefore) { ripple = computeRipple(dragBefore, margins()); refreshDynamic(); }
  dragBefore = null;
});

// If the page was reloaded mid-launch, replay the launch for this attempt.
render();

// Expose for quick console checks.
if (DEBUG) window.__md = { state: () => state, budgets, simulate, buildCharts };
